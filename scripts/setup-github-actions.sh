#!/bin/bash

# Setup GitHub Actions authentication for Terraform operations
# This script configures Workload Identity Federation for secure authentication
# Supports both Terraform validation and full deployment operations

set -e

# Constants
POOL_NAME="github-actions"
PROVIDER_NAME="github-provider"
SERVICE_ACCOUNT_NAME="github-actions-terraform"
LOCATION="global"

# Helper functions
log() {
	echo "$1"
}

error_exit() {
	echo "Error: $1" >&2
	exit 1
}

check_resource_state() {
	local resource_type="$1"
	local resource_name="$2"
	local describe_cmd="$3"

	log "Checking $resource_type state..." >&2
	if state=$(eval "$describe_cmd" 2>/dev/null); then
		if [ -n "$state" ]; then
			log "$resource_type '$resource_name' found with state: $state" >&2
			echo "$state"
		else
			log "$resource_type exists but state is empty" >&2
			echo "UNKNOWN"
		fi
	else
		log "$resource_type not found" >&2
		echo "NOT_FOUND"
	fi
}

handle_deleted_resource() {
	local resource_type="$1"
	local undelete_cmd="$2"

	log "$resource_type is in DELETED state. Undeleting it..."
	if ! eval "$undelete_cmd"; then
		error_exit "Failed to undelete $resource_type"
	fi
	log "$resource_type has been undeleted"
}

# Get configuration from current environment
echo "Getting project configuration..."
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
echo "Project ID: $PROJECT_ID"

echo "Getting GitHub repository..."
GITHUB_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
echo "GitHub repo: $GITHUB_REPO"

# Validate PROJECT_ID
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
	error_exit "No Google Cloud project configured. Please run: gcloud config set project YOUR_PROJECT_ID"
fi

# Validate GITHUB_REPO
if [ -z "$GITHUB_REPO" ]; then
	error_exit "Could not determine GitHub repository. Please run this script from within a GitHub repository directory and ensure you're authenticated with GitHub CLI: gh auth login"
fi

log "Setting up GitHub Actions authentication for project: $PROJECT_ID"
log "Repository: $GITHUB_REPO"

# Extract repository owner from GITHUB_REPO (format: owner/repo)
REPO_OWNER=$(echo "$GITHUB_REPO" | cut -d'/' -f1)
log "Repository owner: $REPO_OWNER"

# Get project number
log "Getting project number..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
log "Project number: $PROJECT_NUMBER"

# Common gcloud parameters
GCLOUD_COMMON="--project=$PROJECT_ID --location=$LOCATION"
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# Handle workload identity pool
POOL_STATE=$(check_resource_state "workload identity pool" "$POOL_NAME" \
	"gcloud iam workload-identity-pools describe $POOL_NAME $GCLOUD_COMMON --format='value(state)'")

case "$POOL_STATE" in
"DELETED")
	handle_deleted_resource "Pool" \
		"gcloud iam workload-identity-pools undelete $POOL_NAME $GCLOUD_COMMON"
	;;
"ACTIVE")
	log "Pool is active, skipping creation"
	;;
"NOT_FOUND")
	log "Creating new workload identity pool..."
	# shellcheck disable=SC2086
	if ! gcloud iam workload-identity-pools create "$POOL_NAME" \
		$GCLOUD_COMMON \
		--display-name="GitHub Actions Pool"; then
		error_exit "Failed to create workload identity pool"
	fi
	log "Created workload identity pool"
	;;
*)
	log "Pool state: $POOL_STATE - proceeding with provider setup..."
	;;
esac

# Handle workload identity provider
PROVIDER_STATE=$(check_resource_state "workload identity provider" "$PROVIDER_NAME" \
	"gcloud iam workload-identity-pools providers describe $PROVIDER_NAME $GCLOUD_COMMON --workload-identity-pool=$POOL_NAME --format='value(state)'")

SKIP_PROVIDER_CREATION=false
case "$PROVIDER_STATE" in
"DELETED")
	handle_deleted_resource "Provider" \
		"gcloud iam workload-identity-pools providers undelete $PROVIDER_NAME $GCLOUD_COMMON --workload-identity-pool=$POOL_NAME"
	SKIP_PROVIDER_CREATION=true
	;;
"ACTIVE")
	log "Provider is active, skipping creation"
	SKIP_PROVIDER_CREATION=true
	;;
"NOT_FOUND")
	log "Will create new provider..."
	;;
*)
	log "Provider in unexpected state: $PROVIDER_STATE - deleting and recreating..."
	# shellcheck disable=SC2086
	gcloud iam workload-identity-pools providers delete "$PROVIDER_NAME" \
		$GCLOUD_COMMON \
		--workload-identity-pool="$POOL_NAME" \
		--quiet

	log "Waiting for provider deletion to complete..."
	# shellcheck disable=SC2086
	while gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
		$GCLOUD_COMMON --workload-identity-pool="$POOL_NAME" >/dev/null 2>&1; do
		log "Still waiting for provider deletion..."
		sleep 3
	done
	;;
esac

if [ "$SKIP_PROVIDER_CREATION" = false ]; then
	log "Creating workload identity provider..."
	# shellcheck disable=SC2086
	if ! gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
		$GCLOUD_COMMON \
		--workload-identity-pool="$POOL_NAME" \
		--display-name="GitHub Provider" \
		--attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
		--attribute-condition="assertion.repository_owner == '$REPO_OWNER'" \
		--issuer-uri="https://token.actions.githubusercontent.com"; then
		error_exit "Failed to create workload identity provider"
	fi
	log "Created workload identity provider"
fi

# Create service account
log "Creating service account for GitHub Actions..."
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" >/dev/null 2>&1; then
	log "Service account '$SERVICE_ACCOUNT_NAME' already exists"
else
	gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
		--project="$PROJECT_ID" \
		--display-name="GitHub Actions Terraform"
	log "Created service account"
fi

# Allow GitHub repo to impersonate service account
log "Setting up workload identity binding..."
WIF_MEMBER="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/$LOCATION/workloadIdentityPools/$POOL_NAME/attribute.repository/$GITHUB_REPO"
gcloud iam service-accounts add-iam-policy-binding \
	"$SERVICE_ACCOUNT_EMAIL" \
	--project="$PROJECT_ID" \
	--role="roles/iam.workloadIdentityUser" \
	--member="$WIF_MEMBER"

# Grant permissions for Terraform operations
log "Granting IAM permissions for Terraform operations..."

# Core Terraform permissions for AutoNyan project
ROLES=(
	"roles/compute.networkAdmin"
	"roles/compute.securityAdmin"
	"roles/compute.instanceAdmin.v1"
	"roles/iam.serviceAccountUser"
	"roles/storage.admin"
	"roles/resourcemanager.projectIamAdmin"
	"roles/cloudfunctions.admin"
	"roles/pubsub.admin"
	"roles/cloudscheduler.admin"
	"roles/serviceusage.serviceUsageAdmin"
)
SERVICE_ACCOUNT_MEMBER="serviceAccount:$SERVICE_ACCOUNT_EMAIL"
for ROLE in "${ROLES[@]}"; do
	gcloud projects add-iam-policy-binding "$PROJECT_ID" \
		--member="$SERVICE_ACCOUNT_MEMBER" \
		--role="$ROLE" \
		--condition=None
done

# Set GitHub repository secrets
log "Setting GitHub repository secrets..."

WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/$LOCATION/workloadIdentityPools/$POOL_NAME/providers/$PROVIDER_NAME"

# Set the secrets using gh CLI
log "Adding WIF_PROVIDER secret..."
echo "$WIF_PROVIDER" | gh secret set WIF_PROVIDER -R "$GITHUB_REPO"

log "Adding WIF_SERVICE_ACCOUNT secret..."
echo "$SERVICE_ACCOUNT_EMAIL" | gh secret set WIF_SERVICE_ACCOUNT -R "$GITHUB_REPO"

log "Setup complete!"
log ""
log "GitHub repository secrets have been configured automatically."
log "Your GitHub Actions workflow can now:"
log "- Validate Terraform configurations"
log "- Deploy Cloud Functions, Storage buckets, PubSub topics, and Cloud Scheduler jobs"
log "- Manage service accounts and IAM bindings"
