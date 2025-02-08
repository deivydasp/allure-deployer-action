import fs from "fs";
import path from "node:path";
import simpleGit, {SimpleGit} from "simple-git";
import {GithubPagesInterface} from "../interfaces/github-pages.interface.js";
import * as console from "node:console";
import github from "@actions/github";


export type GitHubConfig = {
    owner: string;
    repo: string;
    branch: string;
    workspace: string;
    token: string;
    subFolder: string;
    reportDir: string;
};

export class GithubPagesService implements GithubPagesInterface {
    private git: SimpleGit;
    public readonly branch: string;
    readonly repo: string;
    readonly owner: string;
    subFolder: string;
    reportDir: string;

    constructor({
                    branch,
                    workspace,
                    token,
                    repo,
                    owner, subFolder, reportDir
                }: GitHubConfig) {
        this.git = simpleGit({baseDir: workspace});
        this.branch = branch;
        this.owner = owner;
        this.repo = repo;
        this.subFolder = subFolder;
        this.reportDir = reportDir
        // Authenticate using token (for HTTPS)
        this.git.addConfig('http.extraHeader', `Authorization: token ${token}`);
    }

    async deployPages(): Promise<void> {
        if (!fs.existsSync(this.reportDir)) {
            throw new Error(`Directory does not exist: ${this.reportDir}`);
        }

        // Add files to the git index
        const files = this.getFilePathsFromDir(this.reportDir);
        if (files.length === 0) {
            console.warn(`No files found in the directory: ${this.reportDir}. Deployment aborted.`);
            return;
        }

        // Stage and commit files
        await this.git.add(files);
        await this.git.commit(`Allure report for Github run: ${github.context.runId} `);
        // Push changes to the branch
        await this.git.push('origin', this.branch);
        console.log("Deployment to GitHub Pages complete");
    }

    async setupBranch(): Promise<string> {
        // Initialize repository and fetch branch info
        await this.git.init();
        this.git.addConfig('user.email', '41898282+github-actions[bot]@users.noreply.github.com')
        this.git.addConfig('user.name', 'github-actions[bot]')
        await this.git.addRemote('origin', `https://github.com/${this.owner}/${this.repo}.git`);
        await this.git.fetch('origin', this.branch);  // Fetch only the target branch
        // Check if the remote branch exists
        const branchList = await this.git.branch(['-r', '--list', `origin/${this.branch}`]);
        if (branchList.all.length === 0) {
            console.log(`Remote branch '${this.branch}' does not exist. Creating it from the default branch.`);
            // Get the default branch name
            const defaultBranch = (await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']))
                .trim()
                .split('/').pop()!;
            // Create and switch to a new local branch that tracks the default branch
            await this.git.checkoutBranch(this.branch, `origin/${defaultBranch}`);
            console.log(`Branch '${this.branch}' created from '${defaultBranch}'`);
        } else {
            // Branch exists, switch to it
            await this.git.checkoutBranch(this.branch, `origin/${this.branch}`);
            console.log(`Checked out branch '${this.branch}'`);
        }
        return `https://${this.owner}.github.io/${this.repo}/${this.subFolder}`
    }

    private getFilePathsFromDir(dir: string): string[] {
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