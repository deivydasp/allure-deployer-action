import { Order } from "allure-deployer-shared";
import { DefaultArtifactClient } from '@actions/artifact';
import pLimit from "p-limit";
import { getAbsoluteFilePaths } from "../utilities/util.js";
import { Octokit } from "@octokit/rest";
import github from "@actions/github";
import https from 'https';
import fs from "fs";
import path from "node:path";
export class ArtifactService {
    constructor(token) {
        this.token = token;
        this.artifactClient = new DefaultArtifactClient();
        this.octokit = new Octokit({ auth: this.token });
    }
    async deleteFile(fileName) {
        await this.artifactClient.deleteArtifact(fileName);
    }
    deleteFiles(matchGlob) {
        throw new Error('Not implemented');
    }
    async download({ destination, concurrency = 10, files }) {
        const limit = pLimit(concurrency);
        const promises = [];
        for (const file of files) {
            promises.push(limit(async () => {
                const response = await this.octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}', {
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    artifact_id: file.id,
                    archive_format: 'zip',
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                });
                const artifactUrl = response.url;
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
    async getFiles({ matchGlob, order, maxResults, endOffset }) {
        const octokit = new Octokit({ auth: this.token });
        const response = await octokit.request('GET /repos/{owner}/{repo}/actions/artifacts', {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            name: matchGlob,
            per_page: maxResults,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        return order ? this.sortFiles(response.data.artifacts, order) : response.data.artifacts;
    }
    sortFiles(files, order) {
        if (!files || files.length < 2) {
            return files;
        }
        files = files.filter(file => file.created_at);
        return files.sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            return order === Order.byOldestToNewest ? aTime - bTime : bTime - aTime;
        });
    }
    async upload(filePath, destination) {
        const files = getAbsoluteFilePaths(filePath);
        await this.artifactClient.uploadArtifact(path.basename(destination), files, filePath);
    }
}
