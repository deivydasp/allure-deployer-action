import {ArgsInterface} from "allure-deployer-shared";
export interface GitHubArgInterface extends ArgsInterface{
    googleCredentialData?: string;
    githubToken?: string;
    target: Target;
    storageRequired: boolean;
    gitWorkspace: string;
}
export enum Target {FIREBASE, GITHUB}