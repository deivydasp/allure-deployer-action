# Allure Deployer Action

Host Allure reports on the web with History, Retries, Report Aggregation, and Slack integration. 

**Supported Deployment Targets:**
- **GitHub Pages**
- **Firebase Hosting**

**Supported Runners:**  
- `ubuntu-latest`
- `macos-latest`
- `windows-latest`
- `Self-hosted runner`. Ensure you have a Java runtime installed and [firewall rules configured](https://github.com/actions/toolkit/tree/main/packages/artifact#breaking-changes).

  
## Example 1: Deploy to GitHub Pages

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
        uses: cybersokari/allure-deployer-action@v1.6.2
        with:
          target: 'github'
          github_token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          github_pages_branch: 'gh-pages'
          allure_results_path: 'allure-results'
          show_history: 'true'
          retries: 5
```
Example test run: [actions/runs/12783827755](https://github.com/cybersokari/allure-deployer-action/actions/runs/12783827755)

---

## Example 2: Deploy to Firebase Hosting

```yaml
jobs:
  firebase:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to Firebase with History and Retries
        uses: cybersokari/allure-deployer-action@v1.6.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```
Example test run: [actions/runs/12783830022](https://github.com/cybersokari/allure-deployer-action/actions/runs/12783830022)

___

## Example 3: Print test report URL as Pull Request comment

```yaml
on:
  pull_request:
jobs:
  allure-pr:
    runs-on: ubuntu-latest
    permissions: 
      pull-requests: write # For when `pr_comment` is `true`
      issues: write # For when `pr_comment` is `true`
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to GitHub pages on Pull Request
        uses: cybersokari/allure-deployer-action@v1.6.2
        with:
          pr_comment: 'true'
          github_token: ${{ secrets.GITHUB_TOKEN }}
          target: 'github'
          allure_results_path: 'allure-results'
          show_history: 'true'
          retries: 5
```
Pull request comment [example](https://github.com/cybersokari/allure-deployer-action/actions/runs/12903543578/attempts/1#summary-35978983051)
```markdown
📊 Test Report: https://your-example-url.web.app
| ✅ Passed | ⚠️ Broken |
|----------|-----------|
| 15       | 2         |
```
---

## Example 4: Aggregate report from multiple Allure results directories

```yaml
jobs:
  aggregate-allure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test in multi-module project
        run: # Run test and create multiple allure results directories
      - name: Deploy Reports
        uses: cybersokari/allure-deployer-action@v1.6.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results_1,allure-results_2,allure-results_3'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```
---

## Example 5: Deploy and notify in Slack

```yaml
jobs:
  aggregate-allure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test in project
        run: # Run test and create allure results directory
      - name: Deploy Report, notify Slack
        uses: cybersokari/allure-deployer-action@v1.6.2
        with:
          target: 'github'
          github_token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          github_pages_branch: 'gh-pages'
          allure_results_path: 'allure-results'
          show_history: 'true'
          retries: 5
          slack_channel: ${{ secrets.SLACK_CHANNEL }}
          slack_token: ${{ secrets.SLACK_TOKEN }}
```
---


## Configuration Options (Inputs)

| Name                      | Description                                                                                 | Default Value    | Required? |
|---------------------------|---------------------------------------------------------------------------------------------|------------------|-----------|
| `allure_results_path`     | Path(s) to Allure results. Separate multiple paths with commas.                             | `allure-results` | Yes       |
| `target`                  | Deployment target: `firebase` or `github`.                                                  | None             | Yes       |
| `google_credentials_json` | Firebase credentials to enable **History**, **Retries**, and **Firebase Hosting**.          | None             | No        |
| `github_token`            | GitHub token or personal access token to enable GitHub pages hosting and `pr_comment`       | None             | No        |
| `report_name`             | Custom name/title for the report.                                                           | `Allure Report`  | No        |
| `language`                | Allure report language                                                                      | `en`             | No        |
| `storage_bucket`          | Google Cloud Storage bucket name for **History** and **Retries** when target is `firebase`. | None             | No        |
| `show_history`            | Display history from previous runs.                                                         | `true`           | No        |
| `retries`                 | Number of previous runs to display as retries.                                              | 0                | No        |
| `output`                  | Directory to generate the Allure report in.                                                 | None             | No        |
| `slack_channel`           | Slack channel ID for report notifications.                                                  | None             | No        |
| `slack_token`             | Slack app token for sending notifications.                                                  | None             | No        |
| `pr_comment`              | Post report information as a pull request comment.                                          | `true`           | No        |
| `github_pages_branch`     | Branch used for GitHub Pages deployments.                                                   | `gh-pages`       | No        |
| `github_subfolder`        | Sub directory to write the test reports files in Git                                        | None             | No        |
| `gcp_bucket_prefix`       | Path prefix for archived files in the GCP storage bucket when target is `firebase` .        | None             | No        |



## Outputs
| Name         | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |


## Setup Notes

- **Firebase Hosting:**  
  Export a [service account](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) JSON file from your Firebase Console.
- **Slack Integration:**  
  Create a Slack app, and generate a token for notifications.
- **Pull Request Comments:**  
  Ensure `github_token` permissions include `pull_requests: write` and `issues: write`.

For more information, refer to the [documentation](https://github.com/cybersokari/allure-report-deployer).


## Contributing and Licensing

- **License:** BSD-3 License. See the [License](licenses.txt) file for details.
- **Contributing:** Contributions are welcome! Open issues or submit pull requests to help improve this action.
