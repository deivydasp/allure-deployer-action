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
import {error, warning, info} from "@actions/core";
import {copyDirectory, setGoogleCredentialsEnv, validateSlackConfig} from "./utilities/util.js";
import {ArtifactService, ArtifactServiceConfig} from "./services/artifact.service.js";
import {GithubStorage, GithubStorageConfig} from "./features/github-storage.js";
import {mkdir} from "fs/promises"
import inputs from "./io.js";
import normalizeUrl from "normalize-url";

export function main() {
    (async () => await executeDeployment())();
}

async function executeDeployment() {
    try {
        await mkdir(inputs.REPORTS_DIR, {recursive: true, mode: 0o755});
        let host: HostingProvider
        if (inputs.target === 'firebase') {
            const credentials = inputs.google_credentials_json;
            if (!credentials) {
                error("Firebase Hosting require a valid 'google_credentials_json'");
                process.exit(1);
            }
            let firebaseProjectId = (await setGoogleCredentialsEnv(credentials)).project_id;
            host = getFirebaseHost({firebaseProjectId, REPORTS_DIR: inputs.REPORTS_DIR});
        } else {
            const token = inputs.github_token;
            if (!token) {// Check for empty string
                error("Github Pages require a valid 'github_token'");
                process.exit(1);
            }
            host = getGitHubHost({
                token,
                reportDir: inputs.REPORTS_DIR,
                workspace: inputs.GIT_WORKSPACE
            });
        }

        const storageRequired: boolean = inputs.show_history || inputs.retries > 0
        const storage = storageRequired ? await initializeStorage() : undefined
        const [reportUrl] = await stageDeployment({host, storage});
        const config: AllureConfig = {
            RESULTS_STAGING_PATH: inputs.RESULTS_STAGING_PATH,
            REPORTS_DIR: inputs.REPORTS_DIR,
            reportLanguage: inputs.language
        }
        const allure = new Allure({config});
        await generateAllureReport({allure, reportUrl});
        const [resultsStats] = await finalizeDeployment({host, storage});
        await sendNotifications(resultsStats, reportUrl, allure.environments);
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

function getFirebaseHost({firebaseProjectId, REPORTS_DIR}: {
    firebaseProjectId: string;
    REPORTS_DIR: string;
}): FirebaseHost {
    return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR), inputs.keep);
}

function getGitHubHost({
                           token,
                           reportDir, workspace
                       }: {
    token: string;
    reportDir: string;
    workspace: string;
}): GithubHost {
    const branch = inputs.github_pages_branch!;
    const [owner, repo] = inputs.github_pages_repo!.split('/')
    const config: GitHubConfig = {
        owner,
        repo,
        workspace,
        token, branch,
        reportDir
    }
    return new GithubHost(new GithubPagesService(config));
}

async function initializeStorage(): Promise<IStorage | undefined> {
    const RESULTS_PATHS = await validateResultsPaths(inputs.allure_results_path)
    const storageConfig: GoogleStorageConfig | GithubStorageConfig = {
        ARCHIVE_DIR: inputs.ARCHIVE_DIR,
        RESULTS_PATHS,
        REPORTS_DIR: inputs.REPORTS_DIR,
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
        return new GoogleStorageService(bucket, inputs.gcs_bucket_prefix)
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

async function finalizeDeployment({storage, host}: {
    storage?: IStorage, host: HostingProvider
}) {
    info("Finalizing deployment...");
    const result: [ReportStatistic, any, void, void] = await Promise.all([
        getReportStats(inputs.REPORTS_DIR),
        host.deploy(),
        storage?.uploadArtifacts(),
        copyReportToCustomDir(inputs.REPORTS_DIR),
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