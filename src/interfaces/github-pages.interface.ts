export interface GithubPagesInterface {
    branch: string;
    owner: string;
    repo: string;
    runNumber: number;
    deployPages({dir}: { dir: string}): Promise<void>;
    setupBranch(): Promise<void>;
}