import {GithubPagesInterface} from "../../interfaces/github-pages.interface.js";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(readonly client: GithubPagesInterface) {
    }
    async deploy(): Promise<any> {
        await this.client.deployPages();
    }

    async init(): Promise<string> {
        const startTime = Date.now();
        const result = await this.client.setupBranch();
        const endTime = Date.now();
        console.log(`Setup github pages branch took ${endTime - startTime}ms`);
        return result;
    }

}