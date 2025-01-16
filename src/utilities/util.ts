import * as fs from 'fs/promises'

import {StringBuilder} from "./string-builder.js";
import process from "node:process";
import {readJsonFile} from "./file-util.js";
import {ServiceAccountJson} from "./google-credentials-helper.js";
import chalk from "chalk";
import {ReportStatistic, SlackConfig} from "allure-deployer-shared";
import path from "node:path";


export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. ${chalk.blue('slack_channel')} and ${chalk.blue('slack_token')} must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};

export function appLog(data: string) {
    console.log(data)
}

export async function countFiles(directory: string[]) {
    let count = 0;
    try {
        for (const dir of directory) {
            const entries = await fs.readdir(dir, {withFileTypes: true});
            const files = entries.filter((entry) => entry.isFile());
            count += files.length;
        }
    } catch (err) {
        appLog(`Error reading directory: ${err}`);
    }
    return count
}

export function isFileTypeAllure(filePath: string) {
    return !!filePath.match(/^.*\.(json|png|jpeg|jpg|gif|properties|log|webm|html|mp4)$/i)
}

/**
 * Validates and filters the file paths from a comma-separated string.
 *
 * @param commaSeparatedResultPaths - A string containing file paths separated by commas.
 * @returns A Promise resolving to an array of valid file paths that exist on the filesystem.
 */
export async function validateResultsPaths(commaSeparatedResultPaths: string): Promise<string[]> {
    // If the input does not contain commas, return it as a single-element array
    if (!commaSeparatedResultPaths.includes(',')) {
        const exists = await fs.access(commaSeparatedResultPaths)
            .then(() => true)
            .catch(() => false);
        return exists ? [commaSeparatedResultPaths] : [];
    }
    // Split the string into an array of paths and filter only existing paths
    const paths = commaSeparatedResultPaths.split(',');
    const validPaths: string[] = [];
    for (const path of paths) {
        const trimmedPath = path.trim(); // Remove any extra spaces
        const exists = await fs.access(trimmedPath)
            .then(() => true)
            .catch(() => false);
        if (exists) {
            validPaths.push(trimmedPath);
        }
    }
    return validPaths;
}

export async function getReportStats(summaryJsonDir: string): Promise<ReportStatistic> {
    const summaryJson = await readJsonFile(summaryJsonDir)
    return summaryJson.statistic as ReportStatistic;
}

export function getDashboardUrl({projectId, storageBucket}: {
    projectId?: string,
    storageBucket: string
}): string {
    if (!projectId) {
        return `http://127.0.0.1:4000/storage/${storageBucket}`
    }
    return new StringBuilder()
        .append("https://console.firebase.google.com/project")
        .append(`/${(projectId)}`)
        .append(`/storage/${storageBucket}/files`).toString()
}

export interface WithOraParams<T> {
    start: string;
    success: string;
    work: () => Promise<T>;
}

export async function setGoogleCredentialsEnv(gcpJson: string): Promise<string> {
    try {
        const serviceAccount =  JSON.parse(gcpJson) as ServiceAccountJson;
        const credPath = 'credentials/key.json';
        await fs.mkdir(path.dirname(credPath), { recursive: true });
        await fs.writeFile(credPath, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        return serviceAccount.project_id;
    } catch (e) {
        console.error(e);
        process.exit(1)
    }
}


export function validateSlackConfig(channel?: string, token?: string): SlackConfig | undefined {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.error(ERROR_MESSAGES.INVALID_SLACK_CRED);
        process.exit(1); // Exit if partial inputs are provided
    }
    // Return undefined if any is still missing
    if (!channel || !token) {
        return undefined;
    }
    // Return valid SlackConfig
    return {channel, token};
}

export function parseRetries(value: string): any {
    if (value.toLowerCase() == 'true') {
        return 5
    }
    if (value.toLowerCase() == 'false') {
        return 0
    }
    if (isNaN(Number(value))) {
        console.error('Error: retries must be a positive number')
        process.exit(1)
    }
    const numberValue = Number(value);
    if (numberValue <= 0) {
        return undefined
    }
    return value
}





