import * as process from "node:process";
import path from "node:path";
import {
    Allure, AllureConfig,
    ArgsInterface,
    ConsoleNotifier,
    copyFiles,
    ExecutorInterface,
    FirebaseHost,
    FirebaseService,
    getReportStats,
    getRuntimeDirectory,
    GoogleStorage,
    GoogleStorageService,
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
import core from "@actions/core";
import {copyDirectory, setGoogleCredentialsEnv, validateSlackConfig} from "./utilities/util.js";
import {Inputs, Target} from "./interfaces/inputs.interface.js";
import {ArtifactService, ArtifactServiceConfig} from "./services/artifact.service.js";
import {GithubStorage} from "./features/github-storage.js";
import fs from "fs";

function getTarget(): Target {
    const target = core.getInput("target", {required: true}).toLowerCase();
    if (!["firebase", "github"].includes(target)) {
        console.log("Error: target must be either 'github' or 'firebase'.");
        process.exit(1)
    }
    return target === 'firebase' ? Target.FIREBASE : Target.GITHUB
}

function getRetries(): number {
    const retries = core.getInput("retries");
    return parseInt(retries !== '' ? retries : "0", 10);
}

function getInputOrUndefined(name: string, required?: boolean): string | undefined {
    const input: string = core.getInput(name, {required});
    return input || undefined; // Undefined if empty string
}

export function main() {
    (async () => {

        const target: Target = getTarget();
        const resultsPaths = core.getInput("allure_results_path", {required: true});
        const showHistory = core.getBooleanInput("show_history");
        const retries: number = getRetries()
        const runtimeDir = await getRuntimeDirectory();
        const gitWorkspace = path.posix.join(runtimeDir, 'report')
        await fs.promises.mkdir(gitWorkspace, {recursive: true});
        const reportDir = path.posix.join(gitWorkspace, core.getInput('github_subfolder'));
        const storageRequired: boolean = showHistory || retries > 0
        const [owner, repo] = getInputOrUndefined('github_pages_repo', true)!.split('/')
        const args: Inputs = {
            reportLanguage: getInputOrUndefined('language'),
            downloadRequired: storageRequired,
            uploadRequired: storageRequired,
            runtimeCredentialDir: path.posix.join(runtimeDir, "credentials/key.json"),
            fileProcessingConcurrency: 10,
            RESULTS_PATHS: await validateResultsPaths(resultsPaths),
            RESULTS_STAGING_PATH: path.posix.join(runtimeDir, "allure-results"),
            ARCHIVE_DIR: path.posix.join(runtimeDir, "archive"),
            REPORTS_DIR: reportDir,
            retries,
            showHistory,
            storageRequired,
            target,
            gitWorkspace,
            owner, repo
        };

        if (target === Target.FIREBASE) {
            const credentials = getInputOrUndefined("google_credentials_json");
            if (!credentials) {
                core.error("Firebase Hosting requires a valid 'google_credentials_json'.");
                process.exit(1);
            }
            let firebaseProjectId = (await setGoogleCredentialsEnv(credentials)).project_id;
            args.googleCredentialData = credentials;
            args.firebaseProjectId = firebaseProjectId;
            args.host = getFirebaseHost({firebaseProjectId, REPORTS_DIR: reportDir})
            args.storageBucket = getInputOrUndefined('gcs_bucket');
        } else {
            const token = getInputOrUndefined("github_token");
            if (!token) {
                core.setFailed("Error: Github Pages require a 'github_token'.");
                return;
            }
            args.githubToken = token;
            args.host = getGitHubHost({
                token,
                reportDir,
                gitWorkspace, repo, owner
            });
        }
        await executeDeployment(args);
    })();
}

async function executeDeployment(args: Inputs) {
    try {

        const storage = args.storageRequired ? await initializeStorage(args) : undefined
        const [reportUrl] = await stageDeployment(args, storage);
        const config: AllureConfig = {
            RESULTS_STAGING_PATH: args.RESULTS_STAGING_PATH,
            REPORTS_DIR: args.REPORTS_DIR,
            reportLanguage: args.reportLanguage
        }
        const allure = new Allure({config});
        await generateAllureReport({allure, reportUrl});
        const [resultsStats] = await finalizeDeployment({args, storage});
        await sendNotifications(args, resultsStats, reportUrl, allure.environments);
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

function getFirebaseHost({firebaseProjectId, REPORTS_DIR}: {
    firebaseProjectId: string;
    REPORTS_DIR: string;
}): FirebaseHost {
    return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
}

function getGitHubHost({
                           token,
                           reportDir, gitWorkspace, owner, repo
                       }: {
    token: string;
    reportDir: string;
    gitWorkspace: string;
    owner: string;
    repo: string;
}): GithubHost {
    const subFolder = getInputOrUndefined('github_subfolder', true)!;
    const branch = getInputOrUndefined('github_pages_branch', true)!;
    const config: GitHubConfig = {
        owner,
        repo,
        workspace: gitWorkspace,
        token, subFolder, branch,
        reportDir
    }
    return new GithubHost(new GithubPagesService(config));
}

async function initializeStorage(args: Inputs): Promise<IStorage | undefined> {
    switch (args.target) {
        case Target.GITHUB: {
            const config: ArtifactServiceConfig = {
                owner: args.owner,
                repo: args.repo,
                token: args.githubToken!
            }
            const service = new ArtifactService(config)
            if(await service.hasArtifactReadPermission()){
                return new GithubStorage(service, args)
            }
            core.warning("GitHub token does not have 'actions: write' permission to access GitHub Artifacts. History and Retries will not be included in test reports")
            return undefined
        }
        case Target.FIREBASE: {
            if (args.storageBucket && args.googleCredentialData) {
                return new GoogleStorage(await getCloudStorageService({
                    storageBucket: args.storageBucket,
                    googleCredentialData: args.googleCredentialData
                }), args)
            } else if (!args.storageBucket) {
                console.log('No storage bucket provided. History and Retries will be disabled.');
            }
            return undefined;
        }
        default:
            return undefined
    }
}

async function getCloudStorageService({storageBucket, googleCredentialData}: {
    storageBucket: string,
    googleCredentialData: string
}): Promise<GoogleStorageService> {
    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({credentials}).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            process.exit(1)
        }
        return new GoogleStorageService(bucket, getInputOrUndefined('gcs_bucket_prefix'))
    } catch (error) {
        handleStorageError(error);
        process.exit(1);
    }
}

async function stageDeployment(args: ArgsInterface, storage?: IStorage) {
    console.log("Staging files...");
    const copyResultsFiles = copyFiles({
        from: args.RESULTS_PATHS,
        to: args.RESULTS_STAGING_PATH,
        concurrency: args.fileProcessingConcurrency,
    });
    const result = await Promise.all([
        args.host?.init(),
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
    const reportName = getInputOrUndefined('report_name');
    return {
        reportName: reportName ?? 'Allure Report',
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
    const result: [ReportStatistic, any, void, void] = await Promise.all([
        getReportStats(args.REPORTS_DIR),
        args.host?.deploy(),
        storage?.uploadArtifacts(),
        copyReportToCustomDir(args.REPORTS_DIR),
    ]);
    console.log("Deployment finalized.");
    return result;
}

async function copyReportToCustomDir(reportDir: string): Promise<void> {
    const reportOutputPath = getInputOrUndefined('report_dir');
    if (reportOutputPath) {
        try {
            await copyDirectory(reportDir, reportOutputPath);
        } catch (e) {
            console.error(e);
        }
    }
}

async function sendNotifications(
    args: Inputs,
    resultStatus: ReportStatistic,
    reportUrl?: string,
    environment?: Map<string, string>
) {
    const notifiers: Notifier[] = [new ConsoleNotifier()];
    const slackChannel = core.getInput("slack_channel");
    const slackToken = core.getInput("slack_token");

    if (validateSlackConfig(slackChannel, slackToken)) {
        const slackClient = new SlackService({channel: slackChannel, token: slackToken});
        notifiers.push(new SlackNotifier(slackClient));
    }

    const token = args.githubToken
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = core.getBooleanInput("pr_comment");
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
    console.error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}