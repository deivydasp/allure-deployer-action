import fs from "fs";
import path from "node:path";
import simpleGit, { CheckRepoActions } from "simple-git";
import github from "@actions/github";
import pLimit from "p-limit";
import core from "@actions/core";
import { RequestError } from "@octokit/request-error";
import normalizeUrl from "normalize-url";
export class GithubPagesService {
    constructor({ branch, workspace, token, repo, owner, subFolder, reportDir }) {
        this.branch = branch;
        this.owner = owner;
        this.repo = repo;
        this.subFolder = subFolder;
        this.reportDir = reportDir;
        this.git = simpleGit({ baseDir: workspace });
        this.token = token;
    }
    async deployPages() {
        const [reportDirExists, isRepo] = await Promise.all([
            fs.existsSync(this.reportDir),
            this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
        ]);
        if (!reportDirExists) {
            throw new Error(`Directory does not exist: ${this.reportDir}`);
        }
        if (!isRepo) {
            throw new Error('No repository found. Call setupBranch() to initialize.');
        }
        const files = await this.getFilePathsFromDir(this.reportDir);
        if (files.length === 0) {
            core.error(`No files found in directory: ${this.reportDir}. Deployment aborted.`);
            process.exit(1);
        }
        await this.git.add(files);
        await this.git.commit(`Allure report for GitHub run: ${github.context.runId}`);
        await this.git.push('origin', this.branch);
        console.log(`Allure report pages pushed to '${this.subFolder}' directory on '${this.branch}' branch`);
    }
    async setupBranch() {
        const domain = await this.getPageUrl();
        await this.git.init();
        const headers = {
            Authorization: `Basic ${Buffer.from(`x-access-token:${this.token}`).toString('base64')}`
        };
        this.git.addConfig('http.https://github.com/.extraheader', `AUTHORIZATION: ${headers.Authorization}`, true, 'local');
        const actor = github.context.actor;
        const email = `${github.context.payload.sender?.id}+${actor}@users.noreply.github.com`;
        await this.git
            .addConfig('user.email', email, true, 'local')
            .addConfig('user.name', actor, true, 'local');
        const remote = `${github.context.serverUrl}/${this.owner}/${this.repo}.git`;
        await this.git.addRemote('origin', remote);
        // console.log(`Git remote set to: ${remote}`);
        const fetchResult = await this.git.fetch('origin', this.branch);
        if (fetchResult.branches.length === 0) {
            console.log(`Remote branch '${this.branch}' does not exist. Creating it from the default branch.`);
            const defaultBranch = (await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']))
                .trim()
                .split('/')
                .pop();
            await this.git.checkoutBranch(this.branch, `origin/${defaultBranch}`);
            console.log(`Branch '${this.branch}' created from '${defaultBranch}'.`);
        }
        else {
            await this.git.checkoutBranch(this.branch, `origin/${this.branch}`);
        }
        return normalizeUrl(`${domain}/${this.subFolder}`);
    }
    async getPageUrl() {
        try {
            // Fetch the Pages configuration
            const response = await github.getOctokit(this.token).rest.repos.getPages({
                owner: this.owner,
                repo: this.repo,
            });
            const branch = response.data.source?.branch;
            const type = response.data.build_type;
            if (type != 'legacy' || branch !== this.branch) {
                core.startGroup('Invalid configuration');
                core.error(`Ensure that GitHub pages is configured to deploy from '${this.branch}' branch.`);
                core.error('https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site');
                core.endGroup();
                process.exit(1);
            }
            core.info(`GitHub pages will be deployed from '${branch}' branch!`);
            // Extract the domain
            return response.data.html_url;
        }
        catch (e) {
            if (e instanceof RequestError) {
                switch (e.status) {
                    case 404:
                        {
                            console.error(`GitHub pages is not enabled for this repository`, e.message);
                        }
                        break;
                    default: {
                        core.error(e.message);
                    }
                }
                process.exit(1);
            }
            throw e;
        }
    }
    async getFilePathsFromDir(dir) {
        const files = [];
        const limit = pLimit(10); // Limit concurrent directory operations
        const readDirectory = async (currentDir) => {
            const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
            await Promise.all(entries.map(entry => limit(async () => {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    await readDirectory(fullPath);
                }
                else {
                    files.push(fullPath);
                }
            })));
        };
        await readDirectory(dir);
        return files;
    }
}
