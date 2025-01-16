# Allure Deployer Action
Deploy Allure reports with every feature. History, Retries and Slack. No server required.
</br>
</br>
Supports deployment to `Firebase Hosting` and `GitHub Pages`.
</br>
</br>
Works on all latest Runners (`ubuntu-latest`, `macos-latest`, `windows-latest`) by default.
Requires Java setup for self-hosted Runners.

## 📋 Examples

**Deploy report to GitHub Pages**
</br>Example test run:
[actions/runs/12783827755](https://github.com/cybersokari/allure-deployer-action/actions/runs/12783827755)
```yaml
jobs:
  gh-pages:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to GitHub pages with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'github'
          github_token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          github_pages_branch: 'gh-pages'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} # Required for History and Retries
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```
**Deploy report to Firebase Hosting**
</br>Example test run:
[actions/runs/12783830022](https://github.com/cybersokari/allure-deployer-action/actions/runs/12783830022)
```yaml
jobs:
  firebase:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to Firebase with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```

**Deploy report to Firebase Hosting on Pull request**
```yaml
on:
  pull_request:
jobs:
  firebase:
    runs-on: ubuntu-latest
    permissions: 
      pull-requests: write # For when `pr_comment` is `true`
      issues: write # For when `pr_comment` is `true`
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to Firebase with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
          pr_comment: 'true'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## 🚀 Features
- **Serverless hosting**: Host your reports on GitHub pages or Firebase hosting.
- **History & Retries**: Show Allure History and Retries in reports with linking to previous reports.
- **Report Aggregation**: Aggregate report from multiple Allure results directories.
- **Pull Request Comment**: Post test report URL and status as comment on pull request for your team. See [example.](https://github.com/cybersokari/allure-report-deployer/pull/6#issuecomment-2564403881)
- **Slack Notifications**: Notify stakeholders in Slack with report URL and details.


## 🛠️ Inputs
| Input                     | Description                                                                                                      | Required/Optional | Default          |
|---------------------------|------------------------------------------------------------------------------------------------------------------|-------------------|------------------|
| `allure_results_path`     | A `path/to/results` or comma separate paths '`path/to/results1`,`path/to/results2`' of Allure results.           | Required          | `allure-results` |
| `target`                  | Where to deploy test Report. `firebase` or `github`. `github` requires `github_token`                            | Required          | `github`         |
| `google_credentials_json` | Firebase (Google Cloud) credentials for History, Retries and Firebase Hosting                                    | Optional          | None             |
| `github_token`            | A generated GITHUB_TOKEN or Personal Access Token for `pr_comment` and GitHub Pages                              | Optional          | None             |
| `report_name`             | The name/title of your report.                                                                                   | Optional          | `Allure Report`  |
| `storage_bucket`          | Name of the Google Cloud Storage bucket for backup and history storage.                                          | Optional          | None             |
| `prefix`                  | Path prefix in the Cloud Storage bucket for archiving files for History and Retries.                             | Optional          | None             |
| `show_history`            | Display history from previous test runs.                                                                         | Optional          | `true`           |
| `retries`                 | Number of previous test runs to show as retries in the upcoming report when Storage `storage_bucket` is provided | Optional          | 0                |
| `output`                  | A custom directory to generate Allure report into.                                                               | Optional          | None             |
| `slack_channel`           | ID of the Slack channel to send notifications about report links.                                                | Optional          | None             |
| `slack_token`             | Token for Slack App to send notifications with report URLs.                                                      | Optional          | None             |
| `pr_comment`              | Post test report information as pull request comment. Requires `github_token` to be set with permission          | Optional          | `false`          |
| `github_pages_branch`     | Branch for deploying test report to GitHub Pages. Requires `github_token` to be set with permission              | Optional          | `gh-pages`       |


## 📤 Outputs
| Key          | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |


## 🔧 Environment Setup

- **Firebase Google Credentials**: Export a [service account](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) JSON file from your Firebase Console.
- **Slack Integration**: Optional. Create a Slack app for notifications and obtain its token.
- **Pull request comment**: Optional. Set the `github_token` input with `pull_request` and `issues` write permission enabled 

See [complete documentation](https://github.com/cybersokari/allure-report-deployer) for more info.

## 📜 License
This project is licensed under the [BSD-3 License](licenses.txt). See the LICENSE file for details.

## 🤝 Contributing
Contributions are welcome! Open issues or submit [pull requests](https://github.com/cybersokari/allure-report-deployer) to improve this action.
