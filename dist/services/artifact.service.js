import { Order } from "allure-deployer-shared";
import { DefaultArtifactClient } from '@actions/artifact';
import pLimit from "p-limit";
import { getAbsoluteFilePaths } from "../utilities/util.js";
import { Octokit } from "@octokit/rest";
import https from 'https';
import fs from "fs";
import path from "node:path";
export class ArtifactService {
    constructor({ token, repo, owner }) {
        this.artifactClient = new DefaultArtifactClient();
        this.octokit = new Octokit({ auth: token });
        this.owner = owner;
        this.repo = repo;
    }
    async hasArtifactReadPermission() {
        try {
            await this.getFiles({ maxResults: 1 });
            return true;
        }
        catch (e) {
            return false;
        }
    }
    async deleteFile(id) {
        await this.octokit.request('DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', {
            owner: this.owner,
            repo: this.repo,
            artifact_id: id,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
    }
    deleteFiles(matchGlob) {
        throw new Error('Not implemented');
    }
    async download({ destination, concurrency = 10, files }) {
        const limit = pLimit(concurrency);
        const promises = [];
        for (const file of files) {
            promises.push(limit(async () => {
                const { url } = await this.octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}', {
                    owner: this.owner,
                    repo: this.repo,
                    artifact_id: file.id,
                    archive_format: 'zip',
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                });
                const artifactUrl = url;
                const filePath = path.join(destination, `${file.id}.zip`);
                return new Promise((resolve, reject) => {
                    const fileStream = fs.createWriteStream(filePath);
                    https.get(artifactUrl, (response) => {
                        if (response.statusCode !== 200) {
                            reject(new Error(`Failed to get '${artifactUrl}' (${response.statusCode})`));
                            return;
                        }
                        response.pipe(fileStream);
                        fileStream.on('finish', () => {
                            fileStream.close();
                            resolve(filePath);
                        });
                    }).on('error', (err) => {
                        fs.unlink(filePath, () => reject(err)); // Delete the file if an error occurs
                    });
                });
            }));
        }
        return await Promise.all(promises);
    }
    async getFiles({ matchGlob, order = Order.byOldestToNewest, maxResults, endOffset }) {
        const response = await this.octokit.request('GET /repos/{owner}/{repo}/actions/artifacts', {
            owner: this.owner,
            repo: this.repo,
            name: matchGlob,
            per_page: maxResults,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        const files = response.data.artifacts.filter(file => file.created_at && !file.expired);
        return this.sortFiles(files, order);
    }
    sortFiles(files, order) {
        if (!files || files.length < 2) {
            return files;
        }
        return files.sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            return order === Order.byOldestToNewest ? aTime - bTime : bTime - aTime;
        });
    }
    async upload(filePath, destination) {
        const files = getAbsoluteFilePaths(filePath);
        await this.artifactClient.uploadArtifact(destination, files, filePath);
    }
}
