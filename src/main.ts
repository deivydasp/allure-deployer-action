import * as process from "node:process";
import path from "node:path";
import {
    Allure,
    ArgsInterface,
    ConsoleNotifier,
    copyFiles,
    ExecutorInterface,
    FirebaseHost,
    FirebaseService,
    getDashboardUrl,
    getReportStats,
    getRuntimeDirectory,
    GoogleStorageService,
    HostingProvider,
    NotificationData,
    Notifier,
    NotifyHandler,
    ReportStatistic,
    SlackNotifier,
    SlackService,
    GoogleStorage,
    validateResultsPaths, IStorage,
} from "allure-deployer-shared";
import {Storage as GCPStorage} from "@google-cloud/storage";
import {GitHubService} from "./services/github.service.js";
import {GitHubNotifier} from "./features/messaging/github-notifier.js";
import {GithubPagesService} from "./services/github-pages.service.js";
import {GithubHost} from "./features/hosting/github.host.js";
import github from "@actions/github";
import core from "@actions/core";
import {setGoogleCredentialsEnv, validateSlackConfig} from "./utilities/util.js";
import {GitHubArgInterface, Target} from "./interfaces/args.interface.js";
import {ArtifactService} from "./services/artifact.service.js";
import {GithubStorage} from "./features/github-storage.js";

function getGoogleCredentials(): string | undefined {
    const credentials = core.getInput("google_credentials_json");
    if (!credentials) {
        return undefined;
    }
    return credentials;
}

function getGithubToken(): string | undefined {
    const token = core.getInput("github_token");
    if (!token) {
        return undefined;
    }
    return token;
}

function getTarget(): Target {
    const target = core.getInput("target", {required: true}).toLowerCase();
    if (!["firebase", "github"].includes(target)) {
        console.log("Error: target must be either 'github' or 'firebase'.");
        process.exit(1)
    }
    return target === 'firebase'? Target.FIREBASE: Target.GITHUB
}

function getRetries(): number {
    const retries = core.getInput("retries");
    return parseInt( retries !== '' ? retries: "0", 10);
}

export function main() {
    (async () => {
        const githubToken = getGithubToken();
        const target = getTarget();
        const resultsPaths = core.getInput("allure_results_path", {required: true});
        const showHistory = core.getBooleanInput("show_history");
        const retries = getRetries()
        const runtimeDir = await getRuntimeDirectory();
        const reportOutputPath = core.getInput("output");
        const REPORTS_DIR = reportOutputPath !== '' ? reportOutputPath : path.join(runtimeDir, "allure-report");
        const ghBranch = core.getInput("github_pages_branch");

        const googleCreds = getGoogleCredentials();
        let firebaseProjectId: string | undefined;
        if (googleCreds) {
            firebaseProjectId = await setGoogleCredentialsEnv(googleCreds);
        }

        if (!firebaseProjectId && !githubToken) {
            core.setFailed("Error: You must set either 'google_credentials_json' or 'github_token'.");
        }
        if (target === Target.GITHUB && !githubToken) {
            core.setFailed("Github Pages require a 'github_token'.");
        }
        if (target === Target.FIREBASE && !googleCreds) {
            core.setFailed("Firebase Hosting require a 'google_credentials_json'.");
        }

        const host = initializeHost({
            target,
            token: githubToken,
            ghBranch,
            firebaseProjectId,
            REPORTS_DIR,
        });

        const storageBucket = core.getInput("storage_bucket")
        const inputs: GitHubArgInterface = {
            googleCredentialData: googleCreds,
            storageBucket: storageBucket !== '' ? storageBucket : undefined,
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
            githubToken,
            target
        };

        await executeDeployment(inputs);
    })();
}

async function executeDeployment(args: GitHubArgInterface) {
    try {

        const storage = await initializeStorage(args)
        const [reportUrl] = await stageDeployment(args, storage);
        const allure = new Allure({args});
        await generateAllureReport({allure, reportUrl});
        const [resultsStats] = await finalizeDeployment({args, storage});
        await sendNotifications(args, resultsStats, reportUrl);
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
    target: Target;
    token?: string;
    ghBranch?: string;
    firebaseProjectId?: string;
    REPORTS_DIR: string;
}): HostingProvider | undefined {
    if (token && ghBranch && target === Target.GITHUB) {
        const client = new GithubPagesService({token, branch: ghBranch, filesDir: REPORTS_DIR});
        return new GithubHost(client, ghBranch);
    } else if (target === Target.FIREBASE && firebaseProjectId) {
        return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
    }
    return undefined;
}

async function initializeStorage(args: GitHubArgInterface): Promise<IStorage | undefined> {
    if(args.target === Target.GITHUB) {
        return new GithubStorage(getArtifactService(args.githubToken!), args)
    }else if(args.storageBucket && args.googleCredentialData) {
        return new GoogleStorage(await getCloudStorageService({storageBucket: args.storageBucket,
            googleCredentialData: args.googleCredentialData}), args)
    }
    return undefined;
}

async function getCloudStorageService ({storageBucket, googleCredentialData}: {storageBucket: string, googleCredentialData: string}  ): Promise<GoogleStorageService> {
    try {
        const credentials = JSON.parse(googleCredentialData!);
        const bucket = new GCPStorage({credentials}).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            process.exit(1)
        }
        return  new GoogleStorageService(bucket, core.getInput("prefix"))
    } catch (error) {
        handleStorageError(error);
        process.exit(1);
    }
}

function getArtifactService(token: string): ArtifactService {
    return new ArtifactService(token)
}

async function stageDeployment(args: ArgsInterface, storage?: IStorage) {
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
                                    }: {
    allure: Allure;
    reportUrl?: string;
}) {
    console.log("Generating Allure report...");
    const result = await allure.generate(createExecutor(reportUrl));
    console.log("Report generated successfully!");
    return result;
}

function createExecutor(reportUrl?: string): ExecutorInterface {
    const buildName = `GitHub Run ID: ${github.context.runId}`;
    return {
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
    return `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
}

async function finalizeDeployment({
                                      args,
                                      storage,
                                  }: {
    args: ArgsInterface;
    storage?: IStorage;
}) {
    console.log("Finalizing deployment...");
    const result = await Promise.all([
        getReportStats(args.REPORTS_DIR),
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
        const slackClient = new SlackService({channel: slackChannel, token: slackToken});
        notifiers.push(new SlackNotifier(slackClient, args));
    }

    const dashboardUrl = process.env.DEBUG === 'true' && args.storageBucket && args.firebaseProjectId
        ? getDashboardUrl({storageBucket: args.storageBucket, projectId: args.firebaseProjectId})
        : undefined;

    const githubNotifierClient = new GitHubService()
    const token = core.getInput("github_token");
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = core.getBooleanInput("pr_comment");
    notifiers.push(new GitHubNotifier({client: githubNotifierClient, token, prNumber, prComment}));
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