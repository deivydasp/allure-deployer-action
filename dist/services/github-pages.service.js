import { Octokit } from "@octokit/rest";
import pLimit from "p-limit";
import fs from "fs";
import path from "node:path";
import github from "@actions/github";
/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
};
/**
 * Utility function to implement retry logic with exponential backoff
 * @param operation - Function to retry
 * @param config - Retry configuration
 * @returns Result of the operation
 */
async function withRetry(operation, config = DEFAULT_RETRY_CONFIG) {
    let lastError = null;
    let delay = config.initialDelay;
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Don't retry if it's not a retryable error
            if (!isRetryableError(error)) {
                throw error;
            }
            // If this was our last attempt, throw the error
            if (attempt === config.maxRetries) {
                throw new Error(`Failed after ${config.maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`);
            }
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
            // Calculate next delay with exponential backoff
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);
            console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms. Error: ${error.message}`);
        }
    }
    throw lastError; // TypeScript needs this
}
/**
 * Determines if an error is retryable based on its status code
 */
function isRetryableError(error) {
    // GitHub API error status codes that are worth retrying
    const retryableStatusCodes = [
        408,
        429,
        500,
        502,
        503,
        504 // Gateway Timeout
    ];
    return (error.status && retryableStatusCodes.includes(error.status) ||
        error.message?.includes('rate limit') ||
        error.message?.includes('timeout') ||
        error.message?.includes('network error'));
}
export class GithubPagesService {
    constructor({ branch, filesDir, retryConfig = DEFAULT_RETRY_CONFIG, token }) {
        this.octokit = new Octokit({ auth: token });
        this.branch = branch;
        this.filesDir = filesDir;
        this.retryConfig = retryConfig;
        this.owner = github.context.repo.owner;
        this.repo = github.context.repo.repo;
        this.runNumber = github.context.runNumber;
    }
    async deployPages() {
        if (!fs.existsSync(this.filesDir)) {
            throw new Error(`Directory does not exist: ${this.filesDir}`);
        }
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;
        // Get parent commit SHA with retry logic
        let latestCommitSha;
        try {
            latestCommitSha = await withRetry(async () => {
                try {
                    const branchRef = await this.octokit.git.getRef({
                        owner,
                        repo,
                        ref: `heads/${this.branch}`
                    });
                    return branchRef.data.object.sha;
                }
                catch (error) {
                    if (error.status === 404) {
                        const defaultBranch = (await this.octokit.repos.get({ owner, repo }))
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
        }
        catch (error) {
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
            console.warn(`No files found in the directory: ${this.filesDir}. Deployment aborted.`);
            return;
        }
        // Create blobs with rate limiting and retry logic
        const limit = pLimit(50);
        const tree = await Promise.all(files.map((file) => limit(async () => {
            const relativePath = path.posix.relative(this.filesDir, file);
            const repoPath = `${github.context.runNumber}/${relativePath}`;
            const content = fs.readFileSync(file, "utf8");
            const blob = await withRetry(async () => this.octokit.git.createBlob({
                owner,
                repo,
                content,
                encoding: "utf-8",
            }), this.retryConfig);
            return {
                path: repoPath,
                mode: "100644",
                type: "blob",
                sha: blob.data.sha,
            };
        })));
        // Create new tree with retry
        const newTree = await withRetry(async () => this.octokit.git.createTree({
            owner,
            repo,
            tree,
            base_tree: baseTreeSha,
        }), this.retryConfig);
        // Create new commit with retry
        const newCommit = await withRetry(async () => this.octokit.git.createCommit({
            owner,
            repo,
            message: `GitHub Pages ${github.context.runId}`,
            tree: newTree.data.sha,
            parents: [latestCommitSha],
        }), this.retryConfig);
        // Update branch reference with retry
        await withRetry(async () => this.octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${this.branch}`,
            sha: newCommit.data.sha,
        }), this.retryConfig);
        console.log("Deployment to GitHub Pages complete with a single commit.");
    }
    async setupBranch() {
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;
        try {
            await withRetry(async () => this.octokit.rest.repos.getBranch({
                owner,
                repo,
                branch: this.branch
            }), this.retryConfig);
        }
        catch (error) {
            if (error.status === 404) {
                const defaultBranch = await withRetry(async () => (await this.octokit.repos.get({ owner, repo })).data.default_branch, this.retryConfig);
                const sha = await withRetry(async () => (await this.octokit.git.getRef({
                    owner,
                    repo,
                    ref: `heads/${defaultBranch}`
                })).data.object.sha, this.retryConfig);
                const ref = `refs/heads/${this.branch}`;
                await withRetry(async () => this.octokit.git.createRef({ owner, repo, ref, sha }), this.retryConfig);
            }
            else {
                throw error;
            }
        }
    }
    getFilesFromDir(dir) {
        const files = [];
        const readDir = (currentDir) => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    readDir(fullPath);
                }
                else {
                    files.push(fullPath);
                }
            }
        };
        readDir(dir);
        return files;
    }
}
