import { unlink } from 'fs/promises';
import {GOOGLE_CREDENTIALS_PATH} from "./constants.js";
import inputs from "../io.js";

async function cleanupCredentials() {
    if(inputs.target === 'firebase'){
        await unlink(GOOGLE_CREDENTIALS_PATH).catch(console.error);
        console.log('google_credentials_json file cleaned up.');
    }
}
await cleanupCredentials();