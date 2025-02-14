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
      actions: write
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to GitHub pages with History and Retries
        uses: cybersokari/allure-deployer-action@v1.8.0
        with:
          target: 'github'
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
        uses: cybersokari/allure-deployer-action@v1.8.0
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          gcs_bucket: ${{vars.STORAGE_BUCKET}}
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
      contents: write
      actions: write
      pull-requests: write # For when `pr_comment` is `true`
      issues: write # For when `pr_comment` is `true`
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to GitHub pages on Pull Request
        uses: cybersokari/allure-deployer-action@v1.8.0
        with:
          pr_comment: 'true'
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

## More examples

- [Aggregate multiple Allure results](examples/aggregate-report.yaml)
- [Deploy and notify in Slack](examples/deploy-slack.yaml)
- [Deploy to another GitHub repository](examples/deploy-external-repo.yaml)


## Configuration Options (Inputs)

| Name                      | Description                                                                                                                                        | Default Value          | Required? |
|---------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|------------------------|-----------|
| `allure_results_path`     | Path(s) to Allure results. Separate multiple paths with commas.                                                                                    | `allure-results`       | Yes       |
| `target`                  | Deployment target: `firebase` or `github`.                                                                                                         | None                   | Yes       |
| `google_credentials_json` | Firebase credentials to enable **History**, **Retries**, and **Firebase Hosting**.                                                                 | None                   | No        |
| `github_token`            | GitHub token or personal access token to enable GitHub pages hosting and `pr_comment`                                                              | `github.token`         | No        |
| `report_name`             | Custom name/title for the report.                                                                                                                  | None                   | No        |
| `language`                | Allure report language                                                                                                                             | `en`                   | No        |
| `gcs_bucket`              | Google Cloud Storage bucket name for **History** and **Retries** when target is `firebase`.                                                        | None                   | No        |
| `show_history`            | Display history from previous runs.                                                                                                                | `true`                 | No        |
| `retries`                 | Number of previous runs to display as retries.                                                                                                     | 0                      | No        |
| `report_dir`              | Directory to generate the Allure report in.                                                                                                        | None                   | No        |
| `slack_channel`           | Slack channel ID for report notifications.                                                                                                         | None                   | No        |
| `slack_token`             | Slack app token for sending notifications.                                                                                                         | None                   | No        |
| `pr_comment`              | Post report information as a pull request comment. Requires GitHub token with `pull_requests: write` and `issues: write` permissions               | `true`                 | No        |
| `github_pages_branch`     | Branch used for GitHub Pages deployments.                                                                                                          | `gh-pages`             | No        |
| `github_pages_repo`       | GitHub repository to deploy GitHub pages. Example owner/repository-nam                                                                             | `github.repository`    | No        |
| `gcs_bucket_prefix`       | Google Cloud Storage bucket prefix for 'History and Retries'. Used to separate History and Retries in multi projects when `target` is `firebase` . | None                   | No        |
| `gh_artifact_prefix`      | Github artifacts prefix for 'History and Retries'. Used to separate History and Retries in multi projects when `target` is `github`                | `github.repository_id` | No        |
| `keep`                    | Number of test reports you want to keep alive.                                                                                                     | `10`                   | No        |



## Outputs
| Name         | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |


## Setup Notes

- **GitHub Pages Hosting:**
  - Ensure `github_token` permissions include `contents: write` and `actions: write`
    - `contents: write` permission is used to push report files to `github_pages_branch`
    - `actions: write` is used to back up Allure History and Retries as GitHub Artifacts.
  - Ensure that GitHub Pages is configured to deploy from the `github_pages_branch` provided. Default branch is `gh-pages` 
- **Firebase Hosting:**  
  Export a [service account](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) JSON file from your Firebase Console.
- **Pull Request Comments:**  
  Ensure `github_token` permissions include `pull_requests: write` and `issues: write`.
- **Slack Integration:**  
  Create a Slack app, and generate a token for notifications.

## Hire Me
Looking for a developer with expertise in automation, DevOps, and test infrastructure?
I'm available for consulting and freelance work.

- **Skills:** Mobile Test Automation (Appium, WebdriverIO), CI/CD, Docker, GitHub Actions, Firebase, and more.
- **Experience:** 8+ years in software engineering, building scalable automation solutions.
- **Contact:** Reach me via email at `sokariharry[@]gmail[dot]com` or connect on [LinkedIn](https://www.linkedin.com/in/sokari/).

Let's work together to improve your testing and deployment processes!

## Contributing and Licensing

- **License:** BSD-3 License. See the [License](licenses.txt) file for details.
- **Contributing:** Contributions are welcome! Open issues or submit pull requests to help improve this action.
