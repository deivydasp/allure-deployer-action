export class GitHubNotifier {
    constructor({ client, prNumber, prComment, token }) {
        this.client = client;
        this.prNumber = prNumber;
        this.token = token;
        this.prComment = prComment;
    }
    async notify(data) {
        let message = "### 📊 Your Test Report is ready\n\n";
        if (data.reportUrl) {
            message += `- **Test Report**: [${data.reportUrl}](${data.reportUrl})\n`;
        }
        if (data.storageUrl) {
            message += `- **File Storage**: [${data.storageUrl}](${data.storageUrl})\n`;
        }
        const passed = data.resultStatus.passed;
        const broken = data.resultStatus.broken;
        const skipped = data.resultStatus.skipped;
        const failed = data.resultStatus.failed;
        const unknown = data.resultStatus.unknown;
        message += `
| ✅ **Passed** | ⚠️ **Broken** | ⏭️ **Skipped** | ❌ **Failed** | ❓ **Unknown**|
|-----------|------------------|---------------|---------------|---------------|
| ${passed} | ${broken}        | ${skipped}    | ${failed}     | ${unknown}|
    `;
        const promises = [];
        if (data.reportUrl) {
            promises.push(this.client.updateOutput({ name: 'report_url', value: data.reportUrl }));
        }
        if (this.token && this.prComment && this.prNumber) {
            promises.push(this.client.updatePr({ message, token: this.token, prNumber: this.prNumber }));
        }
        else {
            promises.push(this.client.updateSummary(message.trim()));
        }
        await Promise.all(promises);
    }
}
