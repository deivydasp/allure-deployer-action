import fs from "fs";
import path from "node:path";
import simpleGit, { CheckRepoActions } from "simple-git";
import github from "@actions/github";
import pLimit from "p-limit";
import core, { info } from "@actions/core";
import normalizeUrl from "normalize-url";
import inputs from "../io.js";
export class GithubPagesService {
    constructor(config) {
        this.branch = config.branch;
        this.owner = config.owner;
        this.repo = config.repo;
        this.reportDir = config.reportDir;
        this.token = config.token;
        this.git = simpleGit({ baseDir: inputs.WORKSPACE });
        this.pageUrl = config.pageUrl;
        this.pagesSourcePath = config.pagesSourcePath;
    }
    /** Deploys the Allure report to GitHub Pages */
    async deployPages() {
        await this.ensureValidState();
        const reportFiles = await this.getFilePathsFromDir(this.reportDir);
        if (reportFiles.length === 0) {
            core.error(`No files found in ${this.reportDir}. Deployment aborted.`);
            process.exit(1);
        }
        await this.git.add(reportFiles);
        await this.git.commit(`Allure report for GitHub run: ${github.context.runId}`);
        await this.git.push("origin", this.branch);
        console.log(`Allure report pages pushed to '${this.reportDir}' on '${this.branch}' branch`);
    }
    /** Ensures the repository and required directories are set up */
    async ensureValidState() {
        const [reportDirExists, isRepo] = await Promise.all([
            fs.existsSync(this.reportDir),
            this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
        ]);
        if (!reportDirExists) {
            throw new Error(`Directory not found: ${this.reportDir}`);
        }
        if (!isRepo) {
            throw new Error("No repository found. Call setupBranch() to initialize.");
        }
        // await Promise.all([
        //     this.deleteOldReports(),
        //     this.createRedirectPage(normalizeUrl(`${this.pageUrl}/${this.subFolder}`))
        // ]) Running them together cause git lock issues
        await this.deleteOldReports();
        await this.createRedirectPage(normalizeUrl(`${this.pageUrl}`));
    }
    /** Initializes and sets up the branch for GitHub Pages deployment */
    async setupBranch() {
        await this.git.init();
        const headers = {
            Authorization: `Basic ${Buffer.from(`x-access-token:${this.token}`).toString("base64")}`,
        };
        await this.git.addConfig("http.https://github.com/.extraheader", `AUTHORIZATION: ${headers.Authorization}`, true, "local");
        const actor = github.context.actor;
        const email = `${github.context.payload.sender?.id}+${actor}@users.noreply.github.com`;
        await this.git
            .addConfig("user.email", email, true, "local")
            .addConfig("user.name", actor, true, "local");
        const remote = `${github.context.serverUrl}/${this.owner}/${this.repo}.git`;
        await this.git.addRemote("origin", remote);
        const fetchResult = await this.git.fetch("origin", this.branch);
        if (fetchResult.branches.length === 0) {
            await this.createBranchFromDefault();
        }
        else {
            await this.git.checkoutBranch(this.branch, `origin/${this.branch}`);
        }
        return this.pageUrl;
    }
    /** Creates a redirect page for the Allure report */
    async createRedirectPage(redirectUrl) {
        const htmlContent = `<!DOCTYPE html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; URL=${normalizeUrl(`${redirectUrl}/index.html`)}">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">`;
        const filePath = path.posix.join(inputs.WORKSPACE, this.pagesSourcePath ?? '', 'index.html');
        await fs.promises.writeFile(filePath, htmlContent);
        await this.git.add(filePath);
        info(`Redirect 'index.html' created at ${filePath}`);
    }
    /** Deletes old Allure reports, keeping the latest `inputs.keep` */
    async deleteOldReports() {
        try {
            const dir = path.posix.join(inputs.WORKSPACE, this.pagesSourcePath ?? '', inputs.prefix ?? '');
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            const limit = pLimit(10);
            let paths = (await Promise.all(entries.map((entry) => limit(async () => {
                const reportIndexHtmlPath = path.posix.join(entry.parentPath, entry.name, 'index.html');
                if (entry.isDirectory() && fs.existsSync(reportIndexHtmlPath)) {
                    return path.dirname(reportIndexHtmlPath); // Return directory name of index.html
                }
                return undefined;
            })))).filter(Boolean);
            if (paths.length >= inputs.keep) {
                paths = await this.sortPathsByModifiedTime(paths);
                const pathsToDelete = paths.slice(0, paths.length - inputs.keep);
                await Promise.all(pathsToDelete.map((pathToDelete) => limit(async () => {
                    await fs.promises.rm(pathToDelete, { recursive: true, force: true });
                    info(`Old Report deleted from '${pathToDelete}'`);
                })));
                await this.git.add("-u");
            }
        }
        catch (e) {
            console.warn("Failed to delete old reports:", e);
        }
    }
    async sortPathsByModifiedTime(paths) {
        const limit = pLimit(5);
        const fileStats = await Promise.all(paths.map((file) => limit(async () => {
            const stats = await fs.promises.stat(file);
            return { file, mtimeMs: stats.mtimeMs };
        })));
        fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
        return fileStats.map((item) => item.file);
    }
    /** Recursively retrieves all file paths from a directory */
    async getFilePathsFromDir(dir) {
        const files = [];
        const limit = pLimit(10);
        const readDirectory = async (currentDir) => {
            const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
            await Promise.all(entries.map((entry) => limit(async () => {
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
    /** Creates a branch from the default branch if it doesn't exist */
    async createBranchFromDefault() {
        const defaultBranch = (await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]))
            .trim()
            .split("/")
            .pop();
        await this.git.checkoutBranch(this.branch, `origin/${defaultBranch}`);
        console.log(`Branch '${this.branch}' created from '${defaultBranch}'.`);
    }
}
