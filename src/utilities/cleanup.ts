import { unlink } from 'fs/promises';
import {GOOGLE_CREDENTIALS_PATH} from "./constants.js";

async function cleanupCredentials() {
    try {
        await unlink(GOOGLE_CREDENTIALS_PATH);
        console.log('Credentials file cleaned up.');
    } catch (error) {
        console.error('No credentials to cleanup');
    }
}
await cleanupCredentials();