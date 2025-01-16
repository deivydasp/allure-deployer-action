export class GithubHost {
    constructor(client, filesDir) {
        this.client = client;
        this.filesDir = filesDir;
    }
    async deploy() {
        await this.client.deployPages({ dir: this.filesDir });
    }
    async init() {
        await this.client.setupBranch();
        return `https://${this.client.owner}.github.io/${this.client.repo}/${this.client.runNumber}`;
    }
}
