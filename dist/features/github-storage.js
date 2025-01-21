import { copyFiles, isFileTypeAllure, Order } from "allure-deployer-shared";
import path from "node:path";
import fs from "fs/promises";
import pLimit from "p-limit";
import * as os from "node:os";
import fsSync from "fs";
import unzipper from "unzipper";
const HISTORY_ARCHIVE_NAME = "last-history";
export class GithubStorage {
    constructor(provider, args) {
        this.provider = provider;
        this.args = args;
    }
    async stageFilesFromStorage() {
        await this.createStagingDirectories();
        const tasks = [];
        if (this.args.showHistory) {
            tasks.push(this.stageHistoryFiles());
        }
        if (this.args.retries) {
            tasks.push(this.stageResultFiles(this.args.retries));
        }
        await Promise.all(tasks);
    }
    unzipToStaging(zipFilePath, outputDir) {
        return new Promise((resolve, reject) => {
            fsSync.createReadStream(zipFilePath)
                .pipe(unzipper.Parse())
                .on("entry", async (entry) => {
                const fullPath = path.join(outputDir, entry.path);
                if (isFileTypeAllure(entry.path)) {
                    entry.pipe(fsSync.createWriteStream(fullPath));
                }
                else {
                    entry.autodrain();
                }
            })
                .on("close", () => resolve(true))
                .on("error", (err) => {
                console.warn("Unzip file error");
                reject(err);
            });
        });
    }
    async uploadArtifacts() {
        try {
            await Promise.all([
                this.uploadNewResults(),
                this.uploadHistory(),
            ]);
        }
        catch (error) {
            console.warn("Error uploading artifacts:", error);
        }
    }
    // ============= Private Helper Methods =============
    /**
     * Ensures the local directories exist.
     */
    async createStagingDirectories() {
        try {
            await Promise.allSettled([
                fs.mkdir(this.args.ARCHIVE_DIR, { recursive: true }),
                fs.mkdir(this.args.RESULTS_STAGING_PATH, { recursive: true })
            ]);
        }
        catch (error) {
            console.error("Error creating archive directory:", error);
            throw error;
        }
    }
    /**
     * Downloads and stages the history archive.
     */
    async stageHistoryFiles() {
        const files = await this.provider.getFiles({
            maxResults: 1,
            matchGlob: HISTORY_ARCHIVE_NAME,
        });
        if (files.length === 0) {
            console.warn("No history files found to stage.");
            return;
        }
        const [downloadedPath] = await this.provider.download({
            files,
            destination: this.args.ARCHIVE_DIR,
        });
        const stagingDir = path.join(this.args.RESULTS_STAGING_PATH, "history");
        await fs.mkdir(stagingDir, { recursive: true });
        await this.unzipToStaging(downloadedPath, stagingDir);
    }
    isResultsArchive(file) {
        return /^\d{13}$/.test(file.name) && file.name !== HISTORY_ARCHIVE_NAME;
    }
    /**
     * Stages the result files and deletes older files exceeding the retry limit.
     * @param retries - Maximum number of files to keep.
     */
    async stageResultFiles(retries) {
        let files = await this.provider.getFiles({
            order: Order.byOldestToNewest,
        });
        // Remove history archive
        files = files.filter(this.isResultsArchive);
        if (files.length === 0)
            return;
        const limit = pLimit(this.args.fileProcessingConcurrency);
        const tasks = [];
        if (files.length > retries) {
            const filesToDelete = files.slice(0, files.length - retries);
            files = files.slice(files.length - retries);
            for (const file of filesToDelete) {
                tasks.push(limit(async () => {
                    try {
                        await this.provider.deleteFile(file.name);
                    }
                    catch (error) {
                        console.warn("Delete file error:", error);
                    }
                }));
            }
        }
        const downloadedPaths = await this.provider.download({
            files,
            destination: this.args.ARCHIVE_DIR,
        });
        for (const filePath of downloadedPaths) {
            tasks.push(limit(async () => {
                await this.unzipToStaging(filePath, this.args.RESULTS_STAGING_PATH);
            }));
        }
        await Promise.allSettled(tasks);
    }
    /**
     * Returns the path for the history folder.
     */
    getHistoryFolder() {
        return path.join(this.args.REPORTS_DIR, "history");
    }
    /**
     * Zips and uploads new results to the remote storage.
     *
     */
    async uploadNewResults() {
        let resultPath;
        if (this.args.RESULTS_PATHS.length == 1) {
            resultPath = this.args.RESULTS_PATHS[0];
        }
        else {
            resultPath = path.join(os.tmpdir(), 'allure-deployer-results-temp');
            await copyFiles({ from: this.args.RESULTS_PATHS, to: resultPath });
        }
        await this.provider.upload(resultPath, `${Date.now()}`);
        await fs.rmdir(resultPath);
    }
    /**
     * Zips and uploads the history archive to the remote storage.
     */
    async uploadHistory() {
        await this.provider.upload(this.getHistoryFolder(), HISTORY_ARCHIVE_NAME);
    }
}
