export class GithubHost {
    constructor(client) {
        this.client = client;
    }
    async deploy() {
        await this.client.deployPages();
    }
    async init() {
        const startTime = Date.now();
        const result = await this.client.setupBranch();
        const endTime = Date.now();
        console.log(`Setup github pages branch took ${endTime - startTime}ms`);
        return result;
    }
}
