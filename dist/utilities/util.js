import * as fs from 'fs/promises';
import process from "node:process";
import chalk from "chalk";
import path from "node:path";
export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. ${chalk.blue('slack_channel')} and ${chalk.blue('slack_token')} must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};
export async function setGoogleCredentialsEnv(gcpJson) {
    try {
        const serviceAccount = JSON.parse(gcpJson);
        const credPath = 'credentials/key.json';
        await fs.mkdir(path.dirname(credPath), { recursive: true });
        await fs.writeFile(credPath, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        return serviceAccount.project_id;
    }
    catch (e) {
        console.error(e);
        process.exit(1);
    }
}
export function validateSlackConfig(channel, token) {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.error(ERROR_MESSAGES.INVALID_SLACK_CRED);
        process.exit(1); // Exit if partial inputs are provided
    }
    if (channel && token) {
        return { channel, token };
    }
    return undefined;
}
