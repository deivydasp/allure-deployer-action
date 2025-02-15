import {DefaultConfig, input, Inputs} from "./interfaces/inputs.interface.js";
import core from "@actions/core";
import process from "node:process";
import path from "node:path";
import os from "node:os";

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

function getInputOrUndefined<T extends input>(name: T): Inputs[T] | undefined {
    const data = core.getInput(name);
    if(data === ''){
        return undefined;
    } else {
        return data as Inputs[T]
    }
}

const inputs : Inputs & DefaultConfig = {
    target: getTarget(),
    language: getInput('language'),
    report_name: getInputOrUndefined('report_name'),
    custom_report_dir: core.getInput('report_dir') || getInputOrUndefined('custom_report_dir'),
    allure_results_path: getInput('allure_results_path', true),
    retries : getInput('retries'),
    show_history: getBooleanInput('show_history'),
    github_token: getInput('github_token'),
    github_pages_branch: getInputOrUndefined('github_pages_branch'),
    github_pages_repo: getInput('github_pages_repo'),
    gcs_bucket: getInputOrUndefined('gcs_bucket'),
    google_credentials_json: getInputOrUndefined('google_credentials_json'),
    pr_comment: getBooleanInput('pr_comment'),
    slack_channel: getInput('slack_channel'),
    slack_token: getInput('slack_token'),
    keep: getInput('keep'),
    prefix: prefix(),
    runtimeCredentialDir: path.posix.join(runtimeDir(), "credentials/key.json"),
    fileProcessingConcurrency: 10,
    RESULTS_STAGING_PATH: path.posix.join(runtimeDir(), "allure-results"),
    ARCHIVE_DIR: path.posix.join(runtimeDir(), "archive"),
    WORKSPACE: workspace(),
};

function replaceWhiteSpace(s: string, replaceValue = '-'): string {
    return s.replace(/\s+/g, replaceValue)
}

function prefix(): string | undefined {
    let prefix
    switch (getTarget()){
        case 'github':{
            prefix = core.getInput('gh_artifact_prefix')
        } break
        case "firebase": {
            prefix = core.getInput('gcs_bucket_prefix')
        }
    }
    if(!prefix){ // if empty string
        prefix = getInputOrUndefined('prefix')
    }
    return  prefix ? replaceWhiteSpace(prefix) : undefined;
}

function workspace(): string{
    return path.posix.join(runtimeDir(), 'report');
}
function runtimeDir(): string{
    return path.posix.join(os.tmpdir(), 'allure-report-deployer');
}

export default inputs