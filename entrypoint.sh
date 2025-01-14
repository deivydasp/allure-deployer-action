#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

# Validate required inputs
if [ -z "$INPUT_GOOGLE_CREDENTIALS_JSON" ]; then
  echo "error: google_credentials_json is not provided" >&2
  exit 1
fi

if [ -z "$INPUT_ALLURE_RESULTS_PATH" ]; then
  echo "Error: allure_results_path is not provided" >&2
  exit 1
fi

# Create directory for the JSON file
DIR="/credentials"
mkdir -p "$DIR"
JSON_FILE="$DIR/key.json"
# Write the $GOOGLE_CREDENTIALS_JSON content to the JSON file
echo "$INPUT_GOOGLE_CREDENTIALS_JSON" > "$JSON_FILE" # No cleanup needed, in non mounted Docker path
# Export as GOOGLE_APPLICATION_CREDENTIALS for Firebase CLI auto auth
export GOOGLE_APPLICATION_CREDENTIALS="$JSON_FILE"

# Construct the command with all optional variables
if [ -n "$INPUT_OUTPUT" ]; then
  deploy_command="allure-deployer generate \"$INPUT_ALLURE_RESULTS_PATH\""
  [ -n "$INPUT_REPORT_NAME" ] && deploy_command="$deploy_command $INPUT_REPORT_NAME"
  [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ] && deploy_command="$deploy_command --gcp-json $GOOGLE_APPLICATION_CREDENTIALS"
  [ -n "$INPUT_STORAGE_BUCKET" ] && deploy_command="$deploy_command --bucket $INPUT_STORAGE_BUCKET"
  [ "$INPUT_RETRIES" ] && deploy_command="$deploy_command --retries $INPUT_RETRIES"
  [ "$INPUT_SHOW_HISTORY" = "true" ] && deploy_command="$deploy_command --show-history"
  [ -n "$INPUT_PREFIX" ] && deploy_command="$deploy_command --prefix $INPUT_PREFIX"
  deploy_command="$deploy_command --output /github/workspace/$INPUT_OUTPUT"
else
  # Ensure INPUT_TARGET is set
  if [ -z "$INPUT_TARGET" ]; then
      echo "Error: INPUT_TARGET is not set. Please specify 'firebase' or 'github'." >&2
      exit 1
  fi

  if [ "$INPUT_TARGET" = "firebase" ]; then
      # Unset INPUT_GITHUB_PAGES_BRANCH if targeting Firebase
      if [ -n "$INPUT_GITHUB_PAGES_BRANCH" ]; then
          unset INPUT_GITHUB_PAGES_BRANCH
      fi
  elif [ "$INPUT_TARGET" = "github" ]; then
      # Ensure INPUT_GITHUB_TOKEN is set for GitHub deployments
      if [ -z "$INPUT_GITHUB_TOKEN" ]; then
          echo "Error: Set github_token for GitHub target." >&2
          exit 1
      fi
  else
      # Handle unexpected INPUT_TARGET values
      echo "Error: Invalid target value. Supported values are 'firebase' and 'github'." >&2
      exit 1
  fi

  deploy_command="allure-deployer deploy \"$INPUT_ALLURE_RESULTS_PATH\""
  [ -n "$INPUT_REPORT_NAME" ] && deploy_command="$deploy_command $INPUT_REPORT_NAME"
  [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ] && deploy_command="$deploy_command --gcp-json $GOOGLE_APPLICATION_CREDENTIALS"
  [ -n "$INPUT_STORAGE_BUCKET" ] && deploy_command="$deploy_command --bucket $INPUT_STORAGE_BUCKET"
  [ "$INPUT_RETRIES" ] && deploy_command="$deploy_command --retries $INPUT_RETRIES"
  [ "$INPUT_SHOW_HISTORY" = "true" ] && deploy_command="$deploy_command --show-history"
  [ -n "$INPUT_SLACK_CHANNEL" ] && deploy_command="$deploy_command --slack-channel $INPUT_SLACK_CHANNEL"
  [ -n "$INPUT_SLACK_TOKEN" ] && deploy_command="$deploy_command --slack-token $INPUT_SLACK_TOKEN"
  [ -n "$INPUT_PREFIX" ] && deploy_command="$deploy_command --prefix $INPUT_PREFIX"
fi

# Execute the constructed command
eval "$deploy_command"
#tail -f /dev/null