import * as process from "node:process";
import {
    Allure, AllureConfig,
    ConsoleNotifier,
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
import pLimit from "p-limit";
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import fs, { stat } from 'fs/promises';

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
        const [reportUrl] = await stageDeployment({ storage, host });
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

async function stageDeployment({storage, host}: {
    storage?: IStorage, host: HostingProvider
}) {
    info("Staging files...");
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path)

    const copyResultsFiles = copyFiles({
        from: RESULTS_PATHS,
        to: inputs.RESULTS_STAGING_PATH,
        concurrency: inputs.fileProcessingConcurrency,
    });
    const result = await Promise.all([
        host.init(),
        copyResultsFiles,
        inputs.show_history || inputs.retries > 0 ? storage?.stageFilesFromStorage() : undefined,
    ]);
    info("Files staged successfully.");
    return result;
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

async function copyFiles({
    from,
    to,
    concurrency = 10,
    overwrite = false,
}: {
    from: string[];
    to: string;
    concurrency?: number;
    overwrite?: boolean;
}): Promise<void> {
    const BIG_FILE_THRESHOLD = 1024 * 1024; // 1MB
    
    // Separate limits for different file sizes
    const smallFileLimit = pLimit(concurrency); // Full concurrency for small files
    const bigFileLimit = pLimit(Math.max(2, Math.floor(concurrency / 3))); // One third concurrency for big files
    
    const copyPromises: Promise<void>[] = [];
    const fileStats: Array<{path: string, size: number, dest: string, isDirectory?: boolean}> = [];

    // Ensure the destination directory exists
    await fs.mkdir(to, { recursive: true });

    // First pass: collect file information
    for (const dir of from) {
        try {
            const files = await fs.readdir(dir, { withFileTypes: true });

            for (const file of files) {
                if (!file.isFile()) continue;

                const filePath = path.posix.join(dir, file.name);
                const destination = path.posix.join(to, file.name);
                
                try {
                    const stats = await stat(filePath);
                    fileStats.push({
                        path: filePath,
                        size: stats.size,
                        dest: destination
                    });
                } catch (error) {
                    console.warn(`Error getting stats for ${filePath}:`, error);
                }
            }
        } catch (error) {
            console.warn(`Error reading directory ${dir}:`, error);
        }
    }

    // Sort files by size (process small files first)
    fileStats.sort((a, b) => a.size - b.size);

    // Second pass: copy files with appropriate strategy
    for (const fileInfo of fileStats) {
        if (fileInfo.size >= BIG_FILE_THRESHOLD) {
            // Big files (>=1MB): streaming with progress
            copyPromises.push(
                bigFileLimit(() => copyBigFileWithStreaming(fileInfo, overwrite))
            );
        } else {
            // Small files (<1MB): standard copy
            copyPromises.push(
                smallFileLimit(() => copySmallFile(fileInfo, overwrite))
            );
        }
    }

    // Monitor overall progress
    const progressMonitor = monitorCopyProgress(fileStats);
    
    try {
        const results = await Promise.allSettled(copyPromises);
        
        // Check for failures
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            console.warn(`${failures.length} file copy operations failed`);
            failures.forEach((failure, index) => {
                if (failure.status === 'rejected') {
                    console.warn(`Copy failure ${index + 1}:`, failure.reason);
                }
            });
        }
        
        progressMonitor.complete();
    } catch (error) {
        progressMonitor.error(error);
        throw error;
    }
}

async function copySmallFile(
    fileInfo: {path: string, size: number, dest: string}, 
    overwrite: boolean
): Promise<void> {
    try {
        await fs.cp(fileInfo.path, fileInfo.dest, { 
            force: overwrite, 
            errorOnExist: false 
        });
    } catch (error) {
        console.error(`❌ Failed to copy small file ${fileInfo.path}:`, error);
        throw error;
    }
}

async function copyBigFileWithStreaming(
    fileInfo: {path: string, size: number, dest: string}, 
    overwrite: boolean
): Promise<void> {
    let readStream: NodeJS.ReadableStream | undefined;
    let writeStream: NodeJS.WritableStream | undefined;
    let bytesWritten = 0;
    const fileName = path.basename(fileInfo.path);

    try {

        readStream = createReadStream(fileInfo.path, {
            highWaterMark: 256 * 1024 // 256KB chunks for big files
        });

        writeStream = createWriteStream(fileInfo.dest, {
            flags: overwrite ? 'w' : 'wx'
        });

        // Track progress for big files
        readStream.on('data', (chunk: Buffer) => {
            bytesWritten += chunk.length;
            
            // Log progress every 10MB or 25% of file size, whichever is smaller
            const progressInterval = Math.min(10 * 1024 * 1024, Math.floor(fileInfo.size * 0.25));
            
            if (progressInterval > 0 && bytesWritten % progressInterval < chunk.length) {
                const progress = ((bytesWritten / fileInfo.size) * 100).toFixed(1);
                console.log(`📊 ${fileName}: ${progress}% (${formatFileSize(bytesWritten)}/${formatFileSize(fileInfo.size)})`);
            }
        });

        await pipeline(readStream, writeStream);
        
        console.log(`✅ Big file copied successfully: ${fileName} (${formatFileSize(fileInfo.size)})`);
    } catch (error) {
        // Cleanup on error
        if (readStream && 'destroy' in readStream) {
            (readStream as any).destroy();
        }
        if (writeStream && 'destroy' in writeStream) {
            (writeStream as any).destroy();
        }

        // Remove partially written file
        try {
            await fs.unlink(fileInfo.dest);
        } catch {
            // Ignore cleanup errors
        }

        console.error(`❌ Failed to copy big file ${fileInfo.path}:`, error);
        throw error;
    }
}

function monitorCopyProgress(fileStats: Array<{path: string, size: number, dest: string}>) {
    const totalSize = fileStats.reduce((sum, file) => sum + file.size, 0);
    const totalFiles = fileStats.length;
    const smallFiles = fileStats.filter(f => f.size < 1024 * 1024).length;
    const bigFiles = fileStats.filter(f => f.size >= 1024 * 1024).length;
    const startTime = Date.now();

    console.log(`📁 Starting to copy ${totalFiles} files (${formatFileSize(totalSize)} total)`);
    console.log(`📊 File breakdown: ${smallFiles} small files (<1MB), ${bigFiles} big files (>=1MB)`);

    return {
        complete: () => {
            const duration = Date.now() - startTime;
            const throughput = totalSize / (duration / 1000);
            console.log(`✅ Copy completed: ${totalFiles} files (${formatFileSize(totalSize)}) in ${formatDuration(duration)}`);
            console.log(`📈 Average throughput: ${formatFileSize(throughput)}/s`);
        },
        error: (error: any) => {
            const duration = Date.now() - startTime;
            console.error(`❌ Copy failed after ${formatDuration(duration)}:`, error);
        }
    };
}

function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}