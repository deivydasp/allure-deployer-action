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
- **Pull Request Comment**: Post test report URL and status as comment on pull request for your team. See [example.](https://github.com/cybersokari/allure-report-deployer/pull/6#issuecomment-2564403881)


## 🛠️ Inputs
| Input Name            | Description                                                                                                   | Required | Default       |
|-----------------------|---------------------------------------------------------------------------------------------------------------|----------|---------------|
| `storage_bucket`      | Google Cloud Storage bucket name.                                                                             | No       | None          |
| `report_name`         | The name/title of your report.                                                                                | No       | Allure Report |
| `slack_channel`       | Slack channel ID                                                                                              | No       | None          |
| `allure_results_path` | Directory containing Allure results.                                                                          | Yes      | None          |
| `retries`             | Number of previous test runs to show as retries in the new report when Storage `storage_bucket` is provided   | No       | `0`           |
| `show_history`        | Display historical data in the test report (`true/false`).                                                    | No       | `true`        |
| `update_pr`           | Add report info as pr comment or actions summary (`comment`/`summary`)                                        | No       | `summary`     |
| `output`              | A directory to generate Allure report into. Setting this value disables report hosting and Slack notification | No       | None          |

## 🔧 Environment Variables
| Variable                  | Description                                                                   | Required | Example                              |
|---------------------------|-------------------------------------------------------------------------------|----------|--------------------------------------|
| `GOOGLE_CREDENTIALS_JSON` | Firebase (Google Cloud) credentials JSON                                      | Yes      | `{ "type": "service_account", ... }` |
| `SLACK_TOKEN`             | Slack Bot API token when `slack_channel` is set                               | No       | `xoxb-****`                          |
| `GITHUB_TOKEN`            | Github auth token for pull request updates if `update_pr` is set to `comment` | No       | `ghp_*****`                          |

## 📤 Outputs
| Key          | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |

## 📋 Example Usage
```yaml
name: Allure Report Deployer
on:
  push:
    branches:
      - main
permissions: # For when `update_pr` is `comment`
  pull-requests: write
  issues: write
jobs:
  deploy-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run test
        run: |
          Run test and create allure results

      - name: Run Allure Report Deployer
        uses: cybersokari/allure-deployer-action@v1.2
        with:
          allure_results_path: 'path/to/allure-results'
          storage_bucket: 'your_bucket_name'
          retries: 4
          show_history: true
          slack_channel: 'YOUR_SLACK_CHANNEL_ID'
          update_pr: 'comment'
        env:
          GOOGLE_CREDENTIALS_JSON: '${{ secrets.GCP_CREDENTIALS_JSON }}'
          SLACK_TOKEN: '${{ secrets.SLACK_TOKEN }}' #Optional
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} #Optional. For when `update_pr` is `comment`
```


## 🔧 Environment Setup

- **Firebase Google Credentials**: Export a [service account](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) JSON file from your Firebase Console.
- **Slack Integration**: Optional. Create a Slack app for notifications and obtain its token.
- **Pull request comment**: Optional. Set the `GITHUB_TOKEN` env with `pull_request` and `issues` write permission enabled 


## 📜 License
This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/license/mit) file for more details.

## 🤝 Contributing
Contributions are welcome! Open issues or submit [pull requests](https://github.com/cybersokari/allure-report-deployer) to improve this action.
