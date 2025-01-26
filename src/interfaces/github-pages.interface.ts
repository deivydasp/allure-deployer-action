export interface GithubPagesInterface {
    branch: string;
    owner: string;
    repo: string;
    subFolder: string;
    deployPages(): Promise<void>;
    setupBranch(): Promise<void>;
}