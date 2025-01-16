import core from "@actions/core";
import github from "@actions/github";
export class GitHubNotifier {
    constructor(client) {
        this.client = client;
    }
    async notify(data) {
        let markdown = "### 📊 Your Test Report is ready\n\n";
        if (data.reportUrl) {
            markdown += `- **Test Report**: [${data.reportUrl}](${data.reportUrl})\n`;
        }
        if (data.storageUrl) {
            markdown += `- **File Storage**: [${data.storageUrl}](${data.storageUrl})\n`;
        }
        const passed = data.resultStatus.passed;
        const broken = data.resultStatus.broken;
        const skipped = data.resultStatus.skipped;
        const failed = data.resultStatus.failed;
        const unknown = data.resultStatus.unknown;
        markdown += `
| ✅ **Passed** | ⚠️ **Broken** | ⏭️ **Skipped** | ❌ **Failed** | ❓ **Unknown**|
|-----------|------------------|---------------|---------------|---------------|
| ${passed} | ${broken}        | ${skipped}    | ${failed}     | ${unknown}|
    `;
        const promises = [];
        if (data.reportUrl) {
            promises.push(this.client.updateOutput({ name: 'report_url', value: data.reportUrl }));
        }
        const token = core.getInput("github_token");
        const prNumber = github.context.payload.pull_request?.number;
        if (token && core.getBooleanInput("pr_comment") && prNumber) {
            promises.push(this.client.updatePr({ message: markdown, token, prNumber }));
        }
        else {
            promises.push(this.client.updateSummary(markdown.trim()));
        }
        await Promise.all(promises);
    }
}
