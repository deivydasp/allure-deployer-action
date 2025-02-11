import {ArgsInterface} from "allure-deployer-shared";
export interface Inputs extends ArgsInterface{
    googleCredentialData?: string;
    githubToken?: string;
    target: Target;
    storageRequired: boolean;
    gitWorkspace: string;
    repo: string;
    owner: string;
}
export enum Target {FIREBASE, GITHUB}