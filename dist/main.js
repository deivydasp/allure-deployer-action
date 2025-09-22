import * as process from "node:process";
import { Allure, ConsoleNotifier, copyFiles, FirebaseHost, FirebaseService, getReportStats, GoogleStorage, GoogleStorageService, NotifyHandler, SlackNotifier, SlackService, validateResultsPaths, } from "allure-deployer-shared";
import { Storage as GCPStorage } from "@google-cloud/storage";
import { GitHubService } from "./services/github.service.js";
import { GitHubNotifier } from "./features/messaging/github-notifier.js";
import { GithubPagesService } from "./services/github-pages.service.js";
import { GithubHost } from "./features/hosting/github.host.js";
import github from "@actions/github";
import { error, warning, info, startGroup, endGroup } from "@actions/core";
import { copyDirectory, setGoogleCredentialsEnv, validateSlackConfig } from "./utilities/util.js";
import { ArtifactService } from "./services/artifact.service.js";
import { GithubStorage } from "./features/github-storage.js";
import { mkdir } from "fs/promises";
import inputs from "./io.js";
import normalizeUrl from "normalize-url";
import path from "node:path";
import { RequestError } from "@octokit/request-error";
export function main() {
    (async () => await executeDeployment())();
}
async function executeDeployment() {
    try {
        let reportDir;
        let host;
        if (inputs.target === 'firebase') {
            reportDir = inputs.WORKSPACE;
            host = await getFirebaseHost(reportDir);
        }
        else {
            const token = inputs.github_token;
            if (!token) { // Check for empty string
                error("Github Pages require a valid 'github_token'");
                process.exit(1);
            }
            const [owner, repo] = inputs.github_pages_repo.split('/');
            const { data } = await github.getOctokit(token).rest.repos.getPages({
                owner,
                repo
            }).catch((e) => {
                if (e instanceof RequestError) {
                    error(e.message);
                }
                else {
                    console.error(e);
                }
                process.exit(1);
            });
            if (data.build_type !== "legacy" || data.source?.branch !== inputs.github_pages_branch) {
                startGroup('Configuration Error');
                error(`GitHub Pages must be configured to deploy from '${inputs.github_pages_branch}' branch.`);
                error(`${github.context.serverUrl}/${inputs.github_pages_repo}/settings/pages`);
                endGroup();
                process.exit(1);
            }
            // remove first '/' from the GitHub pages source directory
            const pagesSourcePath = data.source.path.replace('/', '');
            // reportDir with prefix == workspace/page-source-path/prefix/run-id
            // reportDir without a prefix == workspace/page-source-path/run-id
            const reportSubDir = path.posix.join(pagesSourcePath, inputs.prefix ?? '', Date.now().toString());
            reportDir = path.posix.join(inputs.WORKSPACE, reportSubDir);
            const pageUrl = normalizeUrl(`${data.html_url}/${reportSubDir}`);
            host = getGitHubHost({
                token, pageUrl,
                reportDir, pagesSourcePath,
                workspace: inputs.WORKSPACE
            });
        }
        await mkdir(reportDir, { recursive: true, mode: 0o755 });
        const storageRequired = inputs.show_history || inputs.retries > 0;
        const storage = storageRequired ? await initializeStorage(reportDir) : undefined;
        const [reportUrl] = await stageDeployment({ host, storage });
        const config = {
            RESULTS_STAGING_PATH: inputs.RESULTS_STAGING_PATH,
            REPORTS_DIR: reportDir,
            reportLanguage: inputs.language
        };
        const allure = new Allure({ config });
        await generateAllureReport({ allure, reportUrl });
        const [resultsStats] = await finalizeDeployment({ host, storage, reportDir });
        await sendNotifications(resultsStats, reportUrl, allure.environments);
    }
    catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}
async function getFirebaseHost(REPORTS_DIR) {
    const credentials = inputs.google_credentials_json;
    if (!credentials) {
        error("Firebase Hosting require a valid 'google_credentials_json'");
        process.exit(1);
    }
    let firebaseProjectId = (await setGoogleCredentialsEnv(credentials)).project_id;
    return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR), inputs.keep);
}
function getGitHubHost({ token, reportDir, workspace, pageUrl, pagesSourcePath }) {
    const branch = inputs.github_pages_branch;
    const [owner, repo] = inputs.github_pages_repo.split('/');
    const config = {
        owner,
        repo,
        workspace,
        token, branch,
        reportDir, pageUrl, pagesSourcePath
    };
    return new GithubHost(new GithubPagesService(config));
}
async function initializeStorage(reportDir) {
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path);
    const storageConfig = {
        ARCHIVE_DIR: inputs.ARCHIVE_DIR,
        RESULTS_PATHS,
        REPORTS_DIR: reportDir,
        RESULTS_STAGING_PATH: inputs.RESULTS_STAGING_PATH,
        fileProcessingConcurrency: inputs.fileProcessingConcurrency,
        showHistory: inputs.show_history,
        retries: inputs.retries,
        clean: false,
    };
    switch (inputs.target) {
        case 'github': {
            const [owner, repo] = inputs.github_pages_repo.split('/');
            const config = {
                owner,
                repo,
                token: inputs.github_token
            };
            const service = new ArtifactService(config);
            if (await service.hasArtifactReadPermission()) {
                return new GithubStorage(service, storageConfig);
            }
            warning("GitHub token does not have 'actions: write' permission to access GitHub Artifacts. History and Retries will not be included in test reports");
            return undefined;
        }
        case 'firebase': {
            if (inputs.gcs_bucket && inputs.google_credentials_json) {
                const service = await getCloudStorageService({
                    storageBucket: inputs.gcs_bucket,
                    googleCredentialData: inputs.google_credentials_json
                });
                if (service) {
                    return new GoogleStorage(service, storageConfig);
                }
                return undefined;
            }
            else if (!inputs.gcs_bucket) {
                info('No storage bucket provided. History and Retries will be disabled.');
            }
        }
    }
    return undefined;
}
async function getCloudStorageService({ storageBucket, googleCredentialData }) {
    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({ credentials }).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            info(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            return undefined;
        }
        return new GoogleStorageService(bucket, inputs.prefix);
    }
    catch (error) {
        handleStorageError(error);
        return undefined;
    }
}
async function stageDeployment({ storage, host }) {
    info("Staging files...");
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path);
    
    // Create timed operations
    const timedOperations = [
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
            operation: () => (inputs.show_history || inputs.retries > 0) ? storage?.stageFilesFromStorage() : Promise.resolve(undefined)
        }
    ];

    // Execute operations with timing
    const startTime = Date.now();
    const operationPromises = timedOperations.map(async (op) => {
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
                error
            };
        }
    });

    const results = await Promise.all(operationPromises);
    const totalDuration = Date.now() - startTime;

    // Log timing results
    console.log(`📊 Staging operations completed in ${totalDuration}ms:`);
    
    // Sort by duration (longest first) and log
    const sortedResults = [...results].sort((a, b) => b.duration - a.duration);
    
    sortedResults.forEach((result, index) => {
        const percentage = ((result.duration / totalDuration) * 100).toFixed(1);
        const status = result.status === 'fulfilled' ? '✅' : '❌';
        const errorInfo = result.status === 'rejected' ? ` - Error: ${result.error?.message}` : '';
        
        console.log(`${index + 1}. ${status} ${result.name}: ${result.duration}ms (${percentage}% of total)${errorInfo}`);
    });

    // Log summary
    const slowestOperation = sortedResults[0];
    if (slowestOperation.duration > totalDuration * 0.5) {
        warning(`⚠️  ${slowestOperation.name} took ${slowestOperation.duration}ms (${((slowestOperation.duration / totalDuration) * 100).toFixed(1)}% of total staging time)`);
    }

    // Check for any failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        console.error(`❌ ${failures.length} staging operation(s) failed:`);
        failures.forEach(failure => {
            console.error(`  - ${failure.name}: ${failure.error?.message}`);
        });
    }

    info("Files staged successfully.");
    
    // Return results in original format for compatibility
    return results.map(r => r.result);
}
async function generateAllureReport({ allure, reportUrl, }) {
    info("Generating Allure report...");
    const result = await allure.generate(createExecutor(reportUrl));
    info("Report generated successfully!");
    return result;
}
function createExecutor(reportUrl) {
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
function createGitHubBuildUrl() {
    const { context } = github;
    return normalizeUrl(`${github.context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`);
}
async function finalizeDeployment({ storage, host, reportDir }) {
    info("Finalizing deployment...");
    const result = await Promise.all([
        getReportStats(reportDir),
        host.deploy(),
        storage?.uploadArtifacts(),
        copyReportToCustomDir(reportDir),
    ]);
    info("Deployment finalized.");
    return result;
}
async function copyReportToCustomDir(reportDir) {
    if (inputs.custom_report_dir) {
        try {
            await copyDirectory(reportDir, inputs.custom_report_dir);
        }
        catch (e) {
            console.error(e);
        }
    }
}
async function sendNotifications(resultStatus, reportUrl, environment) {
    const notifiers = [new ConsoleNotifier()];
    const channel = inputs.slack_channel;
    const slackToken = inputs.slack_token;
    if (validateSlackConfig(channel, slackToken)) {
        const slackClient = new SlackService({ channel, token: slackToken });
        notifiers.push(new SlackNotifier(slackClient));
    }
    const token = inputs.github_token;
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = inputs.pr_comment;
    const githubNotifierClient = new GitHubService();
    notifiers.push(new GitHubNotifier({ client: githubNotifierClient, token, prNumber, prComment }));
    const notificationData = { resultStatus, reportUrl, environment };
    await new NotifyHandler(notifiers).sendNotifications(notificationData);
}
function handleStorageError(error) {
    const errorMessage = {
        403: "Access denied. Ensure the Cloud Storage API is enabled and credentials have proper permissions.",
        404: "Bucket not found. Verify the bucket name and its existence.",
    };
    error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}
