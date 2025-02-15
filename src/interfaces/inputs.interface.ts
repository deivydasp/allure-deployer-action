export interface Inputs{
    google_credentials_json?: string;
    github_token: string;
    github_pages_branch?: string;
    github_pages_repo: string;
    gcs_bucket?: string;
    gcs_bucket_prefix?: string;
    target: 'firebase' | 'github';
    report_name?: string
    slack_channel: string
    slack_token: string
    allure_results_path: string
    retries: number;
    show_history: boolean;
    pr_comment: boolean;
    custom_report_dir?: string;
    language: string;
    keep: number;
    prefix: string;
}
export interface DefaultConfig {
    runtimeCredentialDir: string,
    fileProcessingConcurrency: 10,
    RESULTS_STAGING_PATH: string,
    ARCHIVE_DIR: string,
    REPORTS_DIR: string,
    GIT_WORKSPACE: string
}
export interface FirebaseConfig {
    credentials_json: string;
    gcs_bucket: string;
}
export type input = keyof Inputs
