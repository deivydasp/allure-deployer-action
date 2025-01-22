export class GithubHost {
    constructor(client) {
        this.client = client;
    }
    async deploy() {
        await this.client.deployPages();
    }
    async init() {
        await this.client.setupBranch();
        return `https://${this.client.owner}.github.io/${this.client.repo}/${this.client.runNumber}`;
    }
}
