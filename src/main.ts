import * as process from "node:process";
import {
    Allure, AllureConfig,
    ConsoleNotifier,
    copyFiles,
    ExecutorInterface,
    FirebaseHost,
    FirebaseService,
    getReportStats,
    GoogleStorage, GoogleStorageConfig,
    GoogleStorageService, HostingProvider,
    IStorage,
    NotificationData,
    Notifier,
    NotifyHandler,
    ReportStatistic,
    SlackNotifier,
    SlackService,
    validateResultsPaths,
} from "allure-deployer-shared";
import {Storage as GCPStorage} from "@google-cloud/storage";
import {GitHubService} from "./services/github.service.js";
import {GitHubNotifier} from "./features/messaging/github-notifier.js";
import {GitHubConfig, GithubPagesService} from "./services/github-pages.service.js";
import {GithubHost} from "./features/hosting/github.host.js";
import github from "@actions/github";
import {error, warning, info, startGroup, endGroup} from "@actions/core";
import {copyDirectory, setGoogleCredentialsEnv, validateSlackConfig} from "./utilities/util.js";
import {ArtifactService, ArtifactServiceConfig} from "./services/artifact.service.js";
import {GithubStorage, GithubStorageConfig} from "./features/github-storage.js";
import {mkdir} from "fs/promises"
import inputs from "./io.js";
import normalizeUrl from "normalize-url";
import path from "node:path";
import {RequestError} from "@octokit/request-error";

export function main() {
    (async () => await executeDeployment())();
}

async function executeDeployment() {
    try {
        let reportDir
        let host: HostingProvider
        if (inputs.target === 'firebase') {
            reportDir = inputs.WORKSPACE
            host = await getFirebaseHost(reportDir);
        } else {
            const token = inputs.github_token;
            if (!token) {// Check for empty string
                error("Github Pages require a valid 'github_token'");
                process.exit(1);
            }

            const [owner, repo] = inputs.github_pages_repo!.split('/')
            const {data} = await github.getOctokit(token).rest.repos.getPages({
                owner,
                repo
            }).catch((e) => {
                if (e instanceof RequestError) {
                    error(e.message);
                } else {
                    console.error(e);
                }
                process.exit(1);
            });

            if (data.build_type !== "legacy" || data.source?.branch !== inputs.github_pages_branch) {
                startGroup('Configuration Error')
                error(`GitHub Pages must be configured to deploy from '${inputs.github_pages_branch}' branch.`);
                error(`${github.context.serverUrl}/${inputs.github_pages_repo}/settings/pages`)
                endGroup()
                process.exit(1);
            }
            // remove first '/' from the GitHub pages source directory
            const pagesSourcePath = data.source!.path.replace('/', '')

            // reportDir with prefix == workspace/page-source-path/prefix/run-id
            // reportDir without a prefix == workspace/page-source-path/run-id
            const reportSubDir = path.posix.join(pagesSourcePath, inputs.prefix ?? '', Date.now().toString())
            reportDir = path.posix.join(inputs.WORKSPACE, reportSubDir)
            const pageUrl = normalizeUrl(`${data.html_url!}/${reportSubDir}`)
            host = getGitHubHost({
                token, pageUrl,
                reportDir, pagesSourcePath,
                workspace: inputs.WORKSPACE
            });
        }
        await mkdir(reportDir, {recursive: true, mode: 0o755});

        const storageRequired: boolean = inputs.show_history || inputs.retries > 0
        const storage = storageRequired ? await initializeStorage(reportDir) : undefined
        const [reportUrl] = await stageDeployment({host, storage});
        const config: AllureConfig = {
            RESULTS_STAGING_PATH: inputs.RESULTS_STAGING_PATH,
            REPORTS_DIR: reportDir,
            reportLanguage: inputs.language
        }
        const allure = new Allure({config});
        await generateAllureReport({allure, reportUrl});
        const [resultsStats] = await finalizeDeployment({host, storage, reportDir});
        await sendNotifications(resultsStats, reportUrl, allure.environments);
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

async function getFirebaseHost(
    REPORTS_DIR: string): Promise<FirebaseHost> {
    const credentials = inputs.google_credentials_json;
    if (!credentials) {
        error("Firebase Hosting require a valid 'google_credentials_json'");
        process.exit(1);
    }
    let firebaseProjectId = (await setGoogleCredentialsEnv(credentials)).project_id;
    return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR), inputs.keep);
}

function getGitHubHost({
                           token,
                           reportDir, workspace, pageUrl, pagesSourcePath
                       }: {
    token: string;
    reportDir: string;
    workspace: string;
    pageUrl: string;
    pagesSourcePath: string;
}): GithubHost {
    const branch = inputs.github_pages_branch!;
    const [owner, repo] = inputs.github_pages_repo!.split('/')
    const config: GitHubConfig = {
        owner,
        repo,
        workspace,
        token, branch,
        reportDir, pageUrl, pagesSourcePath
    }
    return new GithubHost(new GithubPagesService(config));
}

async function initializeStorage(reportDir: string): Promise<IStorage | undefined> {
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path)
    const storageConfig: GoogleStorageConfig | GithubStorageConfig = {
        ARCHIVE_DIR: inputs.ARCHIVE_DIR,
        RESULTS_PATHS,
        REPORTS_DIR: reportDir,
        RESULTS_STAGING_PATH: inputs.RESULTS_STAGING_PATH,
        fileProcessingConcurrency: inputs.fileProcessingConcurrency,
        showHistory: inputs.show_history,
        retries: inputs.retries,
        clean: false,
    }
    switch (inputs.target) {
        case 'github': {
            const [owner, repo] = inputs.github_pages_repo!.split('/')
            const config: ArtifactServiceConfig = {
                owner,
                repo,
                token: inputs.github_token
            }
            const service = new ArtifactService(config)
            if (await service.hasArtifactReadPermission()) {
                return new GithubStorage(service, storageConfig)
            }
            warning("GitHub token does not have 'actions: write' permission to access GitHub Artifacts. History and Retries will not be included in test reports")
            return undefined
        }
        case 'firebase': {
            if (inputs.gcs_bucket && inputs.google_credentials_json) {
                const service = await getCloudStorageService({
                    storageBucket: inputs.gcs_bucket,
                    googleCredentialData: inputs.google_credentials_json
                })
                if (service) {
                    return new GoogleStorage(service, storageConfig)
                }
                return undefined
            } else if (!inputs.gcs_bucket) {
                info('No storage bucket provided. History and Retries will be disabled.');
            }
        }
    }
    return undefined;
}

async function getCloudStorageService({storageBucket, googleCredentialData}: {
    storageBucket: string,
    googleCredentialData: string
}): Promise<GoogleStorageService | undefined> {
    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({credentials}).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            info(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            return undefined;
        }
        return new GoogleStorageService(bucket, inputs.prefix)
    } catch (error) {
        handleStorageError(error);
        return undefined;
    }
}

interface TimedOperation {
    name: string;
    operation: () => Promise<any>;
}

interface OperationResult {
    name: string;
    result: any;
    duration: number;
    status: 'fulfilled' | 'rejected';
    error?: Error;
}

async function stageDeployment({storage, host}: {
    storage?: IStorage, host: HostingProvider
}) {
    info("Staging files...");
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path);
    
    // Create timed operations
    const timedOperations: TimedOperation[] = [
        {
            name: "host.init()",
            operation: () => host.init()
        },
        {
            name: "copyFiles",
            operation: () => copyFiles({
                from: RESULTS_PATHS,
                to: inputs.RESULTS_STAGING_PATH,
                concurrency: inputs.fileProcessingConcurrency,
            })
        },
        {
            name: "storage.stageFilesFromStorage()",
            operation: () => (inputs.show_history || inputs.retries > 0) ? 
                storage?.stageFilesFromStorage() ?? Promise.resolve(undefined) : 
                Promise.resolve(undefined)
        }
    ];

    // Execute operations with timing
    const startTime = Date.now();
    const operationPromises: Promise<OperationResult>[] = timedOperations.map(async (op: TimedOperation): Promise<OperationResult> => {
        const opStartTime = Date.now();
        try {
            const result = await op.operation();
            const duration = Date.now() - opStartTime;
            return {
                name: op.name,
                result,
                duration,
                status: 'fulfilled'
            };
        } catch (error) {
            const duration = Date.now() - opStartTime;
            return {
                name: op.name,
                result: undefined,
                duration,
                status: 'rejected',
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    });

    const results: OperationResult[] = await Promise.all(operationPromises);
    const totalDuration = Date.now() - startTime;

    // Log timing results
    console.log(`📊 Staging operations completed in ${formatDuration(totalDuration)}:`);
    
    // Sort by duration (longest first) and log
    const sortedResults: OperationResult[] = [...results].sort((a, b) => b.duration - a.duration);
    
    sortedResults.forEach((result: OperationResult, index: number) => {
        const percentage = ((result.duration / totalDuration) * 100).toFixed(1);
        const status = result.status === 'fulfilled' ? '✅' : '❌';
        const errorInfo = result.status === 'rejected' ? ` - Error: ${result.error?.message}` : '';
        
        console.log(`${index + 1}. ${status} ${result.name}: ${formatDuration(result.duration)} (${percentage}% of total)${errorInfo}`);
    });

    // Log summary and warnings
    logPerformanceAnalysis(sortedResults, totalDuration);

    // Check for any failures
    const failures = results.filter((r: OperationResult) => r.status === 'rejected');
    if (failures.length > 0) {
        console.error(`❌ ${failures.length} staging operation(s) failed:`);
        failures.forEach((failure: OperationResult) => {
            console.error(`  - ${failure.name}: ${failure.error?.message}`);
        });
    }

    info("Files staged successfully.");
    
    // Return results in original format for compatibility
    return results.map((r: OperationResult) => r.result);
}

function logPerformanceAnalysis(sortedResults: OperationResult[], totalDuration: number): void {
    const slowestOperation = sortedResults[0];
    
    if (slowestOperation.duration > totalDuration * 0.5) {
        const percentage = ((slowestOperation.duration / totalDuration) * 100).toFixed(1);
        warning(`⚠️  ${slowestOperation.name} took ${formatDuration(slowestOperation.duration)} (${percentage}% of total staging time)`);
    }

    // Additional performance insights
    const significantOperations = sortedResults.filter(op => op.duration > totalDuration * 0.1);
    if (significantOperations.length > 1) {
        console.log(`📈 Operations taking >10% of total time:`);
        significantOperations.forEach((op: OperationResult) => {
            const percentage = ((op.duration / totalDuration) * 100).toFixed(1);
            console.log(`  • ${op.name}: ${percentage}%`);
        });
    }

    // Memory usage check if available
    if (typeof process !== 'undefined' && process.memoryUsage) {
        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        const externalMB = (memUsage.external / 1024 / 1024).toFixed(1);
        console.log(`🧠 Memory usage after staging: Heap: ${heapUsedMB}MB, External: ${externalMB}MB`);
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    
    const seconds = Math.floor(ms / 1000);
    const remainingMs = ms % 1000;
    
    if (seconds < 60) {
        return remainingMs > 0 ? `${seconds}.${Math.floor(remainingMs / 100)}s` : `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes}m ${remainingSeconds}s`;
}

async function generateAllureReport({
                                        allure,
                                        reportUrl,
                                    }: {
    allure: Allure;
    reportUrl?: string;
}) {
    info("Generating Allure report...");
    const result = await allure.generate(createExecutor(reportUrl));
    info("Report generated successfully!");
    return result;
}

function createExecutor(reportUrl?: string): ExecutorInterface {
    const buildName = `GitHub Run ID: ${github.context.runId}`;
    const reportName = inputs.report_name;
    return {
        reportName,
        name: "Allure Deployer Action",
        reportUrl,
        buildUrl: createGitHubBuildUrl(),
        buildName,
        buildOrder: github.context.runNumber,
        type: "github",
    };
}

function createGitHubBuildUrl(): string {
    const {context} = github;
    return normalizeUrl(`${github.context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`);
}

async function finalizeDeployment({storage, host, reportDir}: {
    storage?: IStorage, host: HostingProvider, reportDir: string
}) {
    info("Finalizing deployment...");
    const result: [ReportStatistic, any, void, void] = await Promise.all([
        getReportStats(reportDir),
        host.deploy(),
        storage?.uploadArtifacts(),
        copyReportToCustomDir(reportDir),
    ]);
    info("Deployment finalized.");
    return result;
}

async function copyReportToCustomDir(reportDir: string): Promise<void> {
    if (inputs.custom_report_dir) {
        try {
            await copyDirectory(reportDir, inputs.custom_report_dir);
        } catch (e) {
            console.error(e);
        }
    }
}

async function sendNotifications(
    resultStatus: ReportStatistic,
    reportUrl?: string,
    environment?: Map<string, string>
) {
    const notifiers: Notifier[] = [new ConsoleNotifier()];
    const channel = inputs.slack_channel;
    const slackToken = inputs.slack_token;

    if (validateSlackConfig(channel, slackToken)) {
        const slackClient = new SlackService({channel, token: slackToken});
        notifiers.push(new SlackNotifier(slackClient));
    }

    const token = inputs.github_token
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = inputs.pr_comment;
    const githubNotifierClient = new GitHubService()
    notifiers.push(new GitHubNotifier({client: githubNotifierClient, token, prNumber, prComment}));
    const notificationData: NotificationData = {resultStatus, reportUrl, environment}
    await new NotifyHandler(notifiers).sendNotifications(notificationData);
}

function handleStorageError(error: any) {
    const errorMessage: Record<number, string> = {
        403: "Access denied. Ensure the Cloud Storage API is enabled and credentials have proper permissions.",
        404: "Bucket not found. Verify the bucket name and its existence.",
    };
    error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}