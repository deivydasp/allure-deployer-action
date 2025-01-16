import { unlink } from 'fs/promises';
async function cleanupCredentials(filePath) {
    try {
        await unlink(filePath);
        console.log('Credentials file cleaned up.');
    }
    catch (error) {
        console.error('Failed to clean up credentials file:', error);
    }
}
await cleanupCredentials('credentials/key.json');
