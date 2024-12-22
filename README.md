# Allure Deployer Action
Deploy Allure Reports as a website with ephemeral URLs, history, retries, and Slack notifications. No server required. </br> See [complete documentation](https://github.com/cybersokari/allure-report-deployer) for more info.

## 🚀 Features
- **Serverless Deployment**: Publish Allure test reports to Firebase Hosting.
- **Ephemeral URLs**: Generate unique, time-bound URLs for reports.
- **Slack Notifications**: Notify stakeholders with report details.
- **History & Retries**: Integrate historical trends and retry data into reports.
- **Customizable Settings**: Configure expiration, history, retries, and more.

## 🛠️ Inputs
| Input Name            | Description                                                | Required | Default   |
|-----------------------|------------------------------------------------------------|----------|-----------|
| `storage_bucket`      | Google Cloud Storage bucket name.                          | Yes      | None      |
| `website_id`          | Unique identifier for the hosted report.                   | Yes      | None      |
| `website_expires`     | Report expiration duration (e.g., `2h`, `7d`, `30d`).      | No       | `7d`      |
| `keep_history`        | Save historical data to storage (`true/false`).            | No       | `true`    |
| `keep_results`        | Save retry results to storage (`true/false`).              | No       | `true`    |
| `slack_channel_id`    | Slack channel ID for notifications.                        | No       | None      |
| `allure_results_path` | Directory containing Allure results.                       | Yes      | None      |
| `show_retries`        | Display retries in the test report (`true/false`).         | No       | `true`    |
| `show_history`        | Display historical data in the test report (`true/false`). | No       | `true`    |

## 🔧 Environment Variables
| Variable                | Description                                                                 | Required | Example                              |
|-------------------------|-----------------------------------------------------------------------------|----------|--------------------------------------|
| `SLACK_TOKEN`           | Slack Bot API token for notifications.                                     | No       | `xoxb-****`                          |
| `GCP_CREDENTIALS_JSON`  | Firebase (Google Cloud) credentials JSON as a string, not a file path.     | Yes      | `{ "type": "service_account", ... }` |

## 📤 Outputs
| Output Name  | Description                                |
|--------------|--------------------------------------------|
| `report_url` | URL of the deployed Allure test report.    |

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
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Run Allure Report Deployer
        uses: cybersokari/allure-deployer-action@v1
        with:
          storage_bucket: 'my-bucket-name'
          website_id: 'unique-site-id'
          allure_results_path: './allure-results'
          slack_channel_id: 'SLACK_CHANNEL_ID'
        env:
          SLACK_TOKEN: '${{ secrets.SLACK_TOKEN }}'
          GCP_CREDENTIALS_JSON: '${{ secrets.GCP_CREDENTIALS_JSON }}'
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
