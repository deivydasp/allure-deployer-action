import { unlink } from 'fs/promises';

async function cleanupCredentials(filePath: string) {
    try {
        await unlink(filePath);
        console.log('Credentials file cleaned up.');
    } catch (error) {
        console.error('No credentials to cleanup');
    }
}

await cleanupCredentials('credentials/key.json');