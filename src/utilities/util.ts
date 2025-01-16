import * as fs from 'fs/promises'
import process from "node:process";
import chalk from "chalk";
import {SlackConfig} from "allure-deployer-shared";
import path from "node:path";

type ServiceAccountJson = {
    "type": string,
    "project_id": string,
    "private_key_id": any,
    "private_key": any,
    "client_email": any,
    "client_id": any,
    "auth_uri": any,
    "token_uri": any,
    "auth_provider_x509_cert_url": any,
    "client_x509_cert_url": any,
    "universe_domain": any
}

export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. ${chalk.blue('slack_channel')} and ${chalk.blue('slack_token')} must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};


export async function setGoogleCredentialsEnv(gcpJson: string): Promise<string> {
    try {
        const serviceAccount =  JSON.parse(gcpJson) as ServiceAccountJson;
        const credPath = 'credentials/key.json';
        await fs.mkdir(path.dirname(credPath), { recursive: true });
        await fs.writeFile(credPath, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        return serviceAccount.project_id;
    } catch (e) {
        console.error('Error: Failed to set Google Credentials file',e);
        process.exit(1)
    }
}


export function validateSlackConfig(channel: string, token: string): SlackConfig | undefined {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.warn(ERROR_MESSAGES.INVALID_SLACK_CRED);
    }
    if(channel && token) {
        return {channel, token};
    }
    return undefined;
}




