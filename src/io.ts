import {input, Inputs} from "./interfaces/inputs.interface.js";
import core from "@actions/core";
import process from "node:process";

function getTarget(): 'firebase' | 'github' {
    const target = getInput("target", true).toLowerCase();
    if (target != 'firebase' && target != 'github') {
        core.error("target must be either 'github' or 'firebase'");
        process.exit(1)
    }
    return target
}

function getInput<T extends input>(
    name: T, required: boolean = false,
): Inputs[T] {
    return core.getInput(name, {required}) as Inputs[T];
}
function getBooleanInput<T extends input>(
    name: T, required: boolean = false,
): boolean {
    return core.getBooleanInput(name, {required});
}

function getInputOrUndefined<T extends input>(name: T, required: boolean = false): Inputs[T] | undefined {
    const data = core.getInput(name, {required});
    if(data === ''){
        return undefined;
    } else {
        return data as Inputs[T]
    }
}

const inputs : Inputs  = {
    target: getTarget(),
    language: getInput('language'),
    report_name: getInputOrUndefined('report_name'),
    report_dir: getInputOrUndefined('report_dir'),
    allure_results_path: getInput('allure_results_path', true),
    retries : getInput('retries'),
    show_history: getBooleanInput('show_history'),
    github_token: getInput('github_token'),
    github_pages_branch: getInputOrUndefined('github_pages_branch'),
    github_pages_repo: getInput('github_pages_repo'),
    github_subfolder: getInput('github_subfolder'),
    gcs_bucket: getInputOrUndefined('gcs_bucket'),
    gcs_bucket_prefix: getInputOrUndefined('gcs_bucket_prefix'),
    google_credentials_json: getInputOrUndefined('google_credentials_json'),
    pr_comment: getBooleanInput('pr_comment'),
    slack_channel: getInput('slack_channel'),
    slack_token: getInput('slack_token'),
};

export default inputs