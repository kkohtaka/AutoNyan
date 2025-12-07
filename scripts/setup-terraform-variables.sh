#!/bin/bash

# Exit on error
set -e

# Configuration
TFVARS_FILE="terraform/terraform.tfvars"

echo "Setting up terraform.tfvars for GitHub Actions..."

# Get project ID from gcloud CLI
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
	echo "Error: No Google Cloud project configured"
	echo "Please run: gcloud config set project YOUR_PROJECT_ID"
	exit 1
fi

# Validate required environment variables
if [ -z "$GCP_REGION" ]; then
	echo "Error: GCP_REGION variable is not set"
	exit 1
fi

if [ -z "$DRIVE_FOLDER_ID" ]; then
	echo "Error: DRIVE_FOLDER_ID secret is not set"
	exit 1
fi

if [ -z "$DRIVE_SCANNER_SCHEDULE" ]; then
	echo "Error: DRIVE_SCANNER_SCHEDULE variable is not set"
	exit 1
fi

if [ -z "$CATEGORY_ROOT_FOLDER_ID" ]; then
	echo "Error: CATEGORY_ROOT_FOLDER_ID secret is not set"
	exit 1
fi

if [ -z "$UNCATEGORIZED_FOLDER_ID" ]; then
	echo "Error: UNCATEGORIZED_FOLDER_ID secret is not set"
	exit 1
fi

# Generate terraform.tfvars from GitHub Actions variables/secrets
echo "Generating terraform.tfvars from GitHub Actions variables/secrets..."
cat >"$TFVARS_FILE" <<EOF
project_id = "$PROJECT_ID"
region = "$GCP_REGION"
drive_folder_id = "$DRIVE_FOLDER_ID"
drive_scanner_schedule = "$DRIVE_SCANNER_SCHEDULE"
category_root_folder_id = "$CATEGORY_ROOT_FOLDER_ID"
uncategorized_folder_id = "$UNCATEGORIZED_FOLDER_ID"
EOF

echo "terraform.tfvars generated successfully"
echo "Contents (secrets masked):"
echo "  project_id = $PROJECT_ID"
echo "  region = $GCP_REGION"
echo "  drive_folder_id = [MASKED]"
echo "  drive_scanner_schedule = $DRIVE_SCANNER_SCHEDULE"
echo "  category_root_folder_id = [MASKED]"
echo "  uncategorized_folder_id = [MASKED]"
