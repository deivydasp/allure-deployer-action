# Allure Deployer Action
**Host your Allure Reports on the web with history, retries, and Slack notifications.
No server required.**
</br>
</br> Example report: https://gatedaccessdev.web.app
</br> See [complete documentation](https://github.com/cybersokari/allure-report-deployer) for more info.

## 🚀 Features
- **Serverless hosting**: Host your reports on the [web](https://firebase.google.com/docs/hosting), not storage. 
- **History & Retries**: Show history and retries in reports with history linking to previous reports.
- **Cloud Backup**: Save test results in storage for future analysis.
- **Slack Notifications**: Notify stakeholders with report URL and details.


## 🛠️ Inputs
| Input Name            | Description                                                            | Required | Default       |
|-----------------------|------------------------------------------------------------------------|----------|---------------|
| `storage_bucket`      | Google Cloud Storage bucket name.                                      | No       | None          |
| `report_name`         | The name/title of your report.                                         | No       | Allure Report |
| `slack_channel`       | Slack channel ID for notifications.                                    | No       | None          |
| `allure_results_path` | Directory containing Allure results.                                   | Yes      | None          |
| `show_retries`        | Display retries in the test report (`true/false`).                     | No       | `true`        |
| `show_history`        | Display historical data in the test report (`true/false`).             | No       | `true`        |
| `update_pr`           | Add report info as pr comment or actions summary (`comment`/`summary`) | No       | `summary`     |

## 🔧 Environment Variables
| Variable                  | Description                                                                   | Required | Example                              |
|---------------------------|-------------------------------------------------------------------------------|----------|--------------------------------------|
| `GOOGLE_CREDENTIALS_JSON` | Firebase (Google Cloud) credentials JSON                                      | Yes      | `{ "type": "service_account", ... }` |
| `SLACK_TOKEN`             | Slack Bot API token when `slack_channel` is set                               | No       | `xoxb-****`                          |
| `GITHUB_TOKEN`            | Github auth token for pull request updates if `update_pr` is set to `comment` | No       | `ghp_*****`                          |

## 📤 Outputs
| Output Name  | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |

## 📋 Example Usage
```yaml
name: Allure Report Deployer
on:
  push:
    branches:
      - main
jobs:
  deploy-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run test
        run: |
          Run test and create allure results

      - name: Run Allure Report Deployer
        uses: cybersokari/allure-deployer-action@v1
        with:
          storage_bucket: 'your_bucket_name'
          allure_results_path: 'path/to/allure-results'
          slack_channel: 'YOUR_SLACK_CHANNEL_ID'
        env:
          GOOGLE_CREDENTIALS_JSON: '${{ secrets.GCP_CREDENTIALS_JSON }}'
          SLACK_TOKEN: '${{ secrets.SLACK_TOKEN }}'
```

### Environment Setup

```markdown
## 🔧 Environment Setup
- **Firebase Account**: Ensure access to Firebase Hosting and Google Cloud Storage.
- **Google Cloud Credentials**: Set up a service account and download the JSON key file.
- **Slack Integration**: Optional. Create a Slack app for notifications and obtain its token.
```

## 📜 License
This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/license/mit) file for more details.

## 🤝 Contributing
Contributions are welcome! Open issues or submit pull requests to improve this action.
