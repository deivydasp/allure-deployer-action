export interface Inputs{
    google_credentials_json?: string;
    github_token: string;
    github_pages_branch?: string;
    github_subfolder: string;
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
    report_dir?: string;
    language: string;
}
export interface GithubConfig {
    token: string;
    branch: string;
    subFolder: string;
    owner: string;
    repo: string;
    prComment: boolean;
    prNumber?: number;
}
export interface FirebaseConfig {
    credentialsJson: string;
    bucket: string;
}
export type input = keyof Inputs
