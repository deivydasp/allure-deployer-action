import * as process from "node:process";
// Import necessary modules and commands for the main program functionality
import { Allure, ConsoleNotifier, GoogleStorageService, getDashboardUrl, NotificationData, SlackService, SlackNotifier, Storage, getReportStats, NotifyHandler, FirebaseHost, FirebaseService, validateResultsPaths, getRuntimeDirectory } from "allure-deployer-shared";
import { Storage as GCPStorage } from '@google-cloud/storage';
import { copyFiles, readJsonFile } from "./utilities/file-util.js";
import { GitHubService } from "./services/github.service.js";
import path from "node:path";
import { GitHubNotifier } from "./features/messaging/github-notifier.js";
import { GithubPagesService } from "./services/github-pages.service.js";
import { GithubHost } from "./features/hosting/github.host.js";
import github from "@actions/github";
import core from "@actions/core";
import { setGoogleCredentialsEnv } from "./utilities/util.js";
function getInput(name, options) {
    const input = core.getInput(name, options);
    return input.trim();
}
// Entry point for the application
export function main() {
    (async () => {
        const creds = getInput('google_credentials_json', { required: true });
        const firebaseProjectId = await setGoogleCredentialsEnv(creds);
        const resultsPaths = getInput('allure_results_path', { required: true });
        getInput('storage_bucket');
        const showHistory = core.getBooleanInput('show_history');
        const retries = parseInt(getInput('retries') || '0', 10);
        const runtimeDir = await getRuntimeDirectory();
        const ghBranch = core.getInput('github_pages_branch');
        const token = core.getInput('github_token');
        const REPORTS_DIR = path.join(runtimeDir, 'allure-report');
        let host;
        if (token && ghBranch) {
            const client = new GithubPagesService({ token, branch: ghBranch, filesDir: REPORTS_DIR });
            host = new GithubHost(client, ghBranch);
        }
        else {
            host = new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
        }
        const inputs = {
            runtimeCredentialDir: path.join(runtimeDir, 'credentials/key.json'),
            fileProcessingConcurrency: 10,
            RESULTS_PATHS: await validateResultsPaths(resultsPaths),
            RESULTS_STAGING_PATH: path.join(runtimeDir, 'allure-results'),
            ARCHIVE_DIR: path.join(runtimeDir, 'archive'),
            REPORTS_DIR,
            reportName: getInput('report_name'),
            retries,
            showHistory,
            prefix: getInput('prefix'),
            uploadRequired: showHistory || retries > 0,
            downloadRequired: showHistory || retries > 0,
            firebaseProjectId,
            host
        };
        const outputPath = getInput('output');
        if (outputPath) {
            await runGenerate(inputs);
        }
        else {
            await runDeploy(inputs);
        }
    })();
}
async function runGenerate(args) {
    try {
        const storage = await initializeCloudStorage(args); // Initialize storage bucket
        await setupStaging(args, storage);
        const allure = new Allure({ args });
        await generateReport({ allure, args }); // Generate Allure report
        const [resultsStats] = await finalize({ storage, args }); // Deploy report and artifacts
        await notify(args, resultsStats); // Send deployment notifications
    }
    catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1); // Exit with error code
    }
}
// Executes the deployment process
async function runDeploy(args) {
    try {
        const storage = await initializeCloudStorage(args); // Initialize storage bucket
        const [reportUrl] = await setupStaging(args, storage);
        const allure = new Allure({ args });
        await generateReport({ allure, reportUrl, args }); // Generate Allure report
        const [resultsStats] = await finalize({ args, storage }); // Deploy report and artifacts
        await notify(args, resultsStats, reportUrl); // Send deployment notifications
    }
    catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1); // Exit with error code
    }
}
// Initializes cloud storage and verifies the bucket existence
async function initializeCloudStorage(args) {
    const storageBucket = getInput('storage_bucket');
    if (!storageBucket)
        return undefined;
    try {
        const credentials = await readJsonFile(args.runtimeCredentialDir);
        const bucket = new GCPStorage({ credentials }).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`Storage Bucket '${bucket}' does not exist. History and Retries will be disabled`);
            return undefined;
        }
        return new Storage(new GoogleStorageService(bucket, getInput('prefix')), args);
    }
    catch (error) {
        handleStorageError(error);
        throw error;
    }
}
// Prepares files and configurations for deployment
async function setupStaging(args, storage) {
    const copyResultsFiles = (async () => {
        return await copyFiles({
            from: args.RESULTS_PATHS,
            to: args.RESULTS_STAGING_PATH,
            concurrency: args.fileProcessingConcurrency
        });
    });
    console.log('Staging files...');
    const result = Promise.all([
        args.host?.init(args.clean), // Initialize Firebase hosting site
        copyResultsFiles(),
        args.downloadRequired ? storage?.stageFilesFromStorage() : undefined, // Prepare cloud storage files
    ]);
    console.log('Files staged successfully');
    return result;
}
// Generates the Allure report with metadata
async function generateReport({ allure, reportUrl, args }) {
    const executor = args.host ? createExecutor({ reportUrl }) : undefined;
    console.log('Generating Allure report...');
    const result = await allure.generate(executor);
    console.log('Report generated successfully!');
    return result;
}
function createExecutor({ reportUrl }) {
    const buildName = `GitHub Run ID: ${github.context.runId}`;
    return {
        name: 'Allure Report Deployer',
        reportUrl: reportUrl,
        buildUrl: createGitHubBuildUrl(),
        buildName: buildName,
        type: 'github',
    };
}
function createGitHubBuildUrl() {
    const context = github.context;
    return `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
}
// Deploys the report and associated artifacts
async function finalize({ args, storage }) {
    const start = () => {
        if (args.host)
            return 'Deploying report...';
        if (storage)
            return 'Uploading results and history...';
        return 'Reading report statistic...';
    };
    const success = () => {
        if (args.host)
            return 'Report deployed successfully!';
        if (storage)
            return 'Results and history uploaded!';
        return 'Statistics read completed!';
    };
    start();
    const result = await Promise.all([
        getReportStats(path.join(args.REPORTS_DIR, 'widgets/summary.json')),
        args.host?.deploy(), // Deploy to Firebase hosting
        storage?.uploadArtifacts(), // Upload artifacts to storage bucket
    ]);
    success();
    return result;
}
// Sends notifications about deployment status
async function notify(args, resultsStatus, reportUrl) {
    const notifiers = [new ConsoleNotifier(args)];
    if (args.slackConfig) {
        const slackClient = new SlackService(args.slackConfig);
        notifiers.push(new SlackNotifier(slackClient, args));
    }
    const dashboardUrl = () => {
        return args.storageBucket ? getDashboardUrl({
            storageBucket: args.storageBucket,
            projectId: args.firebaseProjectId,
        }) : undefined;
    };
    notifiers.push(new GitHubNotifier(new GitHubService()));
    const notificationData = new NotificationData(resultsStatus, reportUrl, dashboardUrl());
    await new NotifyHandler(notifiers).sendNotifications(notificationData); // Send notifications via all configured notifiers
}
// Handles errors related to cloud storage
export function handleStorageError(error) {
    if (error.code === 403) {
        console.error('Access denied. Please ensure that the Cloud Storage API is enabled and that your credentials have the necessary permissions.');
    }
    else if (error.code === 404) {
        console.error('Bucket not found. Please verify that the bucket name is correct and that it exists.');
    }
    else if (error.message.includes('Invalid bucket name')) {
        console.error('Invalid bucket name. Please ensure that the bucket name adheres to the naming guidelines.');
    }
    else {
        console.error('An unexpected error occurred:', error);
    }
}
