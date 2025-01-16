import * as fs from 'fs/promises';
import process from "node:process";
import path from "node:path";
import { GOOGLE_CREDENTIALS_PATH } from "./constants.js";
export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. 'slack_channel' and 'slack_token' must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};
export async function setGoogleCredentialsEnv(gcpJson) {
    try {
        const serviceAccount = JSON.parse(gcpJson);
        const credPath = GOOGLE_CREDENTIALS_PATH;
        await fs.mkdir(path.dirname(credPath), { recursive: true });
        await fs.writeFile(credPath, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        return serviceAccount.project_id;
    }
    catch (e) {
        console.error('Error: Failed to set Google Credentials file', e);
        process.exit(1);
    }
}
export function validateSlackConfig(channel, token) {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.warn(ERROR_MESSAGES.INVALID_SLACK_CRED);
    }
    if (channel && token) {
        return { channel, token };
    }
    return undefined;
}
