export interface GithubPagesInterface {
    branch: string;
    owner: string;
    repo: string;
    runNumber: number;
    deployPages(): Promise<void>;
    setupBranch(): Promise<void>;
}