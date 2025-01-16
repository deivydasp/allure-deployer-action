import {GithubPagesInterface} from "../../interfaces/github-pages.interface.js";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(readonly client: GithubPagesInterface, readonly filesDir: string) {
    }
    async deploy(): Promise<any> {
        await this.client.deployPages({dir: this.filesDir});
    }

    async init(): Promise<string> {
        await this.client.setupBranch()
        return `https://${this.client.owner}.github.io/${this.client.repo}/${this.client.runNumber}`
    }

}