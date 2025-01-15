import {GithubPagesInterface} from "../interfaces/github-pages.interface.js";
import {Octokit} from "@octokit/rest";
import pLimit from "p-limit";
import fs from "fs";
import path from "node:path";
import github from "@actions/github";

/**
 * Configuration for retry logic
 */
interface RetryConfig {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 10000,    // 10 seconds
    backoffFactor: 2
};

type GitHubTree = {
    path?: string | undefined;
    mode?: "100644" | "100755" | "040000" | "160000" | "120000" | undefined;
    type?: "blob" | "tree" | "commit" | undefined;
    sha?: string | null | undefined;
    content?: string | undefined;
}


/**
 * Utility function to implement retry logic with exponential backoff
 * @param operation - Function to retry
 * @param config - Retry configuration
 * @returns Result of the operation
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.initialDelay;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;

            // Don't retry if it's not a retryable error
            if (!isRetryableError(error)) {
                throw error;
            }

            // If this was our last attempt, throw the error
            if (attempt === config.maxRetries) {
                throw new Error(
                    `Failed after ${config.maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`
                );
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));

            // Calculate next delay with exponential backoff
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);

            console.warn(
                `Attempt ${attempt} failed. Retrying in ${delay}ms. Error: ${error.message}`
            );
        }
    }

    throw lastError; // TypeScript needs this
}

/**
 * Determines if an error is retryable based on its status code
 */
function isRetryableError(error: any): boolean {
    // GitHub API error status codes that are worth retrying
    const retryableStatusCodes = [
        408, // Request Timeout
        429, // Too Many Requests
        500, // Internal Server Error
        502, // Bad Gateway
        503, // Service Unavailable
        504  // Gateway Timeout
    ];

    return (
        error.status && retryableStatusCodes.includes(error.status) ||
        error.message?.includes('rate limit') ||
        error.message?.includes('timeout') ||
        error.message?.includes('network error')
    );
}

export class GithubPagesService implements GithubPagesInterface {
    private octokit: Octokit;
    public readonly branch: string;
    private readonly filesDir: string;
    private readonly retryConfig: RetryConfig;
    readonly repo: string;
    readonly owner: string;
    readonly runNumber: number;

    constructor({
                    branch,
                    filesDir,
                    retryConfig = DEFAULT_RETRY_CONFIG,
                    token
                }: {
        branch: string,
        filesDir: string,
        retryConfig?: RetryConfig,
        token: string,
    }) {
        this.octokit = new Octokit({auth: token});
        this.branch = branch;
        this.filesDir = filesDir;
        this.retryConfig = retryConfig;
        this.owner = github.context.repo.owner
        this.repo = github.context.repo.repo
        this.runNumber = github.context.runNumber
    }

    async deployPages(): Promise<void> {
        if (!fs.existsSync(this.filesDir)) {
            throw new Error(`Directory does not exist: ${this.filesDir}`);
        }
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;

        // Get parent commit SHA with retry logic
        let latestCommitSha: string;
        try {
            latestCommitSha = await withRetry(async () => {
                try {
                    const branchRef = await this.octokit.git.getRef({
                        owner,
                        repo,
                        ref: `heads/${this.branch}`
                    });
                    return branchRef.data.object.sha;
                } catch (error: any) {
                    if (error.status === 404) {
                        const defaultBranch = (await this.octokit.repos.get({owner, repo}))
                            .data.default_branch;
                        const defaultBranchRef = await this.octokit.git.getRef({
                            owner,
                            repo,
                            ref: `heads/${defaultBranch}`
                        });
                        return defaultBranchRef.data.object.sha;
                    }
                    throw error;
                }
            }, this.retryConfig);
        } catch (error) {
            console.error('Failed to get commit SHA:', error);
            throw error;
        }

        // Get base tree with retry
        const baseTreeSha = await withRetry(async () => {
            const latestCommit = await this.octokit.git.getCommit({
                owner,
                repo,
                commit_sha: latestCommitSha
            });
            return latestCommit.data.tree.sha;
        }, this.retryConfig);

        // Prepare tree objects for all files
        const files = this.getFilesFromDir(this.filesDir);
        if (files.length === 0) {
            console.warn(
                `No files found in the directory: ${this.filesDir}. Deployment aborted.`
            );
            return;
        }

        // Create blobs with rate limiting and retry logic
        const limit = pLimit(50);
        const tree: GitHubTree[] = await Promise.all(
            files.map((file) =>
                limit(async () => {
                    const relativePath = path.posix.relative(this.filesDir, file);
                    const repoPath = `${github.context.runNumber}/${relativePath}`;
                    const content = fs.readFileSync(file, "utf8");

                    const blob = await withRetry(async () =>
                            this.octokit.git.createBlob({
                                owner,
                                repo,
                                content,
                                encoding: "utf-8",
                            })
                        , this.retryConfig);

                    return <GitHubTree>{
                        path: repoPath,
                        mode: "100644",
                        type: "blob",
                        sha: blob.data.sha,
                    };
                })
            )
        );

        // Create new tree with retry
        const newTree = await withRetry(async () =>
                this.octokit.git.createTree({
                    owner,
                    repo,
                    tree,
                    base_tree: baseTreeSha,
                })
            , this.retryConfig);

        // Create new commit with retry
        const newCommit = await withRetry(async () =>
                this.octokit.git.createCommit({
                    owner,
                    repo,
                    message: `GitHub Pages ${github.context.runId}`,
                    tree: newTree.data.sha,
                    parents: [latestCommitSha],
                })
            , this.retryConfig);

        // Update branch reference with retry
        await withRetry(async () =>
                this.octokit.git.updateRef({
                    owner,
                    repo,
                    ref: `heads/${this.branch}`,
                    sha: newCommit.data.sha,
                })
            , this.retryConfig);

        console.log("Deployment to GitHub Pages complete with a single commit.");
    }

    async setupBranch(): Promise<void> {
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;

        try {
            await withRetry(async () =>
                    this.octokit.rest.repos.getBranch({
                        owner,
                        repo,
                        branch: this.branch
                    })
                , this.retryConfig);
        } catch (error: any) {
            if (error.status === 404) {
                const defaultBranch = await withRetry(async () =>
                        (await this.octokit.repos.get({owner, repo})).data.default_branch
                    , this.retryConfig);

                const sha = await withRetry(async () =>
                        (await this.octokit.git.getRef({
                            owner,
                            repo,
                            ref: `heads/${defaultBranch}`
                        })).data.object.sha
                    , this.retryConfig);

                const ref = `refs/heads/${this.branch}`;
                await withRetry(async () =>
                        this.octokit.git.createRef({owner, repo, ref, sha})
                    , this.retryConfig);
            } else {
                throw error;
            }
        }
    }

    private getFilesFromDir(dir: string): string[] {
        const files: string[] = [];

        const readDir = (currentDir: string) => {
            const entries = fs.readdirSync(currentDir, {withFileTypes: true});
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    readDir(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        };

        readDir(dir);
        return files;
    }
}