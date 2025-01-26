import {GithubPagesInterface} from "../../interfaces/github-pages.interface.js";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(readonly client: GithubPagesInterface) {
    }
    async deploy(): Promise<any> {
        await this.client.deployPages();
    }

    async init(): Promise<string> {
        await this.client.setupBranch()
        return `https://${this.client.owner}.github.io/${this.client.repo}/${this.client.subFolder}`
    }

}