import * as process from "node:process";
import path from "node:path";
import {
    Allure,
    ArgsInterface,
    ConsoleNotifier,
    GoogleStorageService,
    getDashboardUrl,
    NotificationData,
    Notifier,
    SlackService,
    SlackNotifier,
    Storage,
    getReportStats,
    ExecutorInterface,
    NotifyHandler,
    ReportStatistic,
    FirebaseHost,
    FirebaseService,
    validateResultsPaths,
    getRuntimeDirectory,
    HostingProvider,
    copyFiles,
} from "allure-deployer-shared";
import { Storage as GCPStorage } from "@google-cloud/storage";
import { GitHubService } from "./services/github.service.js";
import { GitHubNotifier } from "./features/messaging/github-notifier.js";
import { GithubPagesService } from "./services/github-pages.service.js";
import { GithubHost } from "./features/hosting/github.host.js";
import github from "@actions/github";
import core from "@actions/core";
import { setGoogleCredentialsEnv, validateSlackConfig } from "./utilities/util.js";
import { GitHubArgInterface } from "./interfaces/args.interface";

function getGoogleCredentials(): string | undefined {
    const credentials = core.getInput("google_credentials_json");
    if (!credentials) {
        console.log("No Google Credentials found.");
        return undefined;
    }
    return credentials;
}

export function main() {
    (async () => {
        const token = core.getInput("github_token");
        const target = core.getInput("target");
        const resultsPaths = core.getInput("allure_results_path", { required: true });
        const showHistory = core.getBooleanInput("show_history");
        const retries = parseInt(core.getInput("retries") || "0", 10);
        const runtimeDir = await getRuntimeDirectory();
        const reportOutputPath = core.getInput("output");
        const REPORTS_DIR = reportOutputPath !== '' ? reportOutputPath :  path.join(runtimeDir, "allure-report");
        const ghBranch = core.getInput("github_pages_branch");

        const googleCreds = getGoogleCredentials();
        let firebaseProjectId: string | undefined;
        if (googleCreds) {
            firebaseProjectId = await setGoogleCredentialsEnv(googleCreds);
        }

        if (!firebaseProjectId && !token) {
            core.setFailed("Requires either google_credentials_json or github_token.");
            return;
        }

        if (!["firebase", "github"].includes(target)) {
            core.setFailed("Target must be either 'github' or 'firebase'.");
            return;
        }

        const host = initializeHost({
            target,
            token,
            ghBranch,
            firebaseProjectId,
            REPORTS_DIR,
        });

        const inputs: GitHubArgInterface = {
            googleCredentialData: googleCreds,
            storageBucket: googleCreds ? core.getInput("storage_bucket") : undefined,
            runtimeCredentialDir: path.join(runtimeDir, "credentials/key.json"),
            fileProcessingConcurrency: 10,
            RESULTS_PATHS: await validateResultsPaths(resultsPaths),
            RESULTS_STAGING_PATH: path.join(runtimeDir, "allure-results"),
            ARCHIVE_DIR: path.join(runtimeDir, "archive"),
            REPORTS_DIR,
            reportName: core.getInput("report_name"),
            retries,
            showHistory,
            prefix: core.getInput("prefix"),
            uploadRequired: showHistory || retries > 0,
            downloadRequired: showHistory || retries > 0,
            firebaseProjectId,
            host,
        };

        await executeDeployment(inputs);
    })();
}

async function executeDeployment(inputs: GitHubArgInterface) {
    try {
        const storage = inputs.storageBucket && inputs.googleCredentialData
            ? await initializeStorage(inputs)
            : undefined;

        const [reportUrl] = await stageDeployment(inputs, storage);
        const allure = new Allure({ args: inputs });
        await generateAllureReport({ allure, reportUrl, args: inputs });
        const [resultsStats] = await finalizeDeployment({ args: inputs, storage });
        await sendNotifications(inputs, resultsStats, reportUrl);
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

function initializeHost({
                            target,
                            token,
                            ghBranch,
                            firebaseProjectId,
                            REPORTS_DIR,
                        }: {
    target: string;
    token?: string;
    ghBranch?: string;
    firebaseProjectId?: string;
    REPORTS_DIR: string;
}): HostingProvider | undefined {
    if (token && ghBranch && target === "github") {
        const client = new GithubPagesService({ token, branch: ghBranch, filesDir: REPORTS_DIR });
        return new GithubHost(client, ghBranch);
    } else if (target === "firebase" && firebaseProjectId) {
        return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
    }
    return undefined;
}

async function initializeStorage(args: GitHubArgInterface): Promise<Storage | undefined> {
    const { storageBucket, googleCredentialData } = args;
    if (!googleCredentialData || !storageBucket) return undefined;

    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({ credentials }).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`Storage Bucket '${bucket.name}' does not exist. History and retries will be disabled.`);
            return undefined;
        }
        return new Storage(new GoogleStorageService(bucket, core.getInput("prefix")), args);
    } catch (error) {
        handleStorageError(error);
        throw error;
    }
}

async function stageDeployment(args: ArgsInterface, storage?: Storage) {
    console.log("Staging files...");
    const copyResultsFiles = copyFiles({
        from: args.RESULTS_PATHS,
        to: args.RESULTS_STAGING_PATH,
        concurrency: args.fileProcessingConcurrency,
    });
    const result = await Promise.all([
        args.host?.init(args.clean),
        copyResultsFiles,
        args.downloadRequired ? storage?.stageFilesFromStorage() : undefined,
    ]);
    console.log("Files staged successfully.");
    return result;
}

async function generateAllureReport({
                                        allure,
                                        reportUrl,
                                        args,
                                    }: {
    allure: Allure;
    reportUrl?: string;
    args: ArgsInterface;
}) {
    const executor = args.host ? createExecutor(reportUrl) : undefined;
    console.log("Generating Allure report...");
    const result = await allure.generate(executor);
    console.log("Report generated successfully!");
    return result;
}

function createExecutor(reportUrl?: string): ExecutorInterface {
    const buildName = `GitHub Run ID: ${github.context.runId}`;
    return {
        name: "Allure Report Deployer",
        reportUrl,
        buildUrl: createGitHubBuildUrl(),
        buildName,
        type: "github",
    };
}

function createGitHubBuildUrl(): string {
    const { context } = github;
    return `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
}

async function finalizeDeployment({
                                      args,
                                      storage,
                                  }: {
    args: ArgsInterface;
    storage?: Storage;
}) {
    console.log("Finalizing deployment...");
    const result = await Promise.all([
        getReportStats(path.join(args.REPORTS_DIR, "widgets/summary.json")),
        args.host?.deploy(),
        storage?.uploadArtifacts(),
    ]);
    console.log("Deployment finalized.");
    return result;
}

async function sendNotifications(
    args: ArgsInterface,
    resultsStats: ReportStatistic,
    reportUrl?: string
) {
    const notifiers: Notifier[] = [new ConsoleNotifier(args)];
    const slackChannel = core.getInput("slack_channel");
    const slackToken = core.getInput("slack_token");

    if (validateSlackConfig(slackChannel, slackToken)) {
        const slackClient = new SlackService({ channel: slackChannel, token: slackToken });
        notifiers.push(new SlackNotifier(slackClient, args));
    }

    const dashboardUrl = args.storageBucket && args.firebaseProjectId
        ? getDashboardUrl({ storageBucket: args.storageBucket, projectId: args.firebaseProjectId })
        : undefined;

    notifiers.push(new GitHubNotifier(new GitHubService()));
    const notificationData = new NotificationData(resultsStats, reportUrl, dashboardUrl);
    await new NotifyHandler(notifiers).sendNotifications(notificationData);
}

function handleStorageError(error: any) {
    const errorMessage: Record<number, string> = {
        403: "Access denied. Ensure the Cloud Storage API is enabled and credentials have proper permissions.",
        404: "Bucket not found. Verify the bucket name and its existence.",
    };
    console.error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}