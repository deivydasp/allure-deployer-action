import {GithubPagesInterface} from "../../interfaces/github-pages.interface.js";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(readonly client: GithubPagesInterface) {
    }
    async deploy(): Promise<any> {
        await this.client.deployPages();
    }

    async init(): Promise<string> {
        return await this.client.setupBranch()
    }

}