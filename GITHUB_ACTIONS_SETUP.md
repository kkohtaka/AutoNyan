# GitHub Actions Setup for Terraform

This document explains how to configure GitHub Actions variables and secrets for Terraform deployment.

## Required GitHub Repository Configuration

### Repository Variables (Settings → Secrets and variables → Actions → Variables)
Configure these **Variables** (non-sensitive, visible in logs):

- `GCP_PROJECT_ID` - Your Google Cloud project ID
- `GCP_REGION` - Google Cloud region (e.g., `us-central1`, `asia-northeast1`)
- `TF_STATE_BUCKET` - GCS bucket name for Terraform state
- `TF_STATE_LOCATION` - GCS bucket location for Terraform state
- `DRIVE_SCANNER_SCHEDULE` - Cron schedule for drive scanning (e.g., `0 * * * *`)

### Repository Secrets (Settings → Secrets and variables → Actions → Secrets)
Configure these **Secrets** (sensitive, never visible in logs):

- `WIF_PROVIDER` - Workload Identity Provider resource name
- `WIF_SERVICE_ACCOUNT` - Service account email for Workload Identity
- `DRIVE_FOLDER_ID` - Google Drive folder ID to scan (sensitive)

## How It Works

1. **Generate tfvars**: GitHub Actions dynamically creates `terraform.tfvars` from variables/secrets
2. **Secure handling**: Sensitive values (like `DRIVE_FOLDER_ID`) use secrets
3. **Environment-specific**: Different values can be set per environment/branch
4. **No sensitive data in repo**: `terraform.tfvars` is gitignored and generated at runtime

## Local Development

For local development, copy `terraform.tfvars.example` to `terraform.tfvars` and fill in your values:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform.tfvars with your values
```

**Important**: Never commit `terraform.tfvars` to version control.

## Example GitHub Actions Workflow

```yaml
- name: Generate terraform.tfvars
  run: |
    cd terraform
    cat > terraform.tfvars << EOF
    project_id = "${{ vars.GCP_PROJECT_ID }}"
    region = "${{ vars.GCP_REGION }}"
    drive_folder_id = "${{ secrets.DRIVE_FOLDER_ID }}"
    drive_scanner_schedule = "${{ vars.DRIVE_SCANNER_SCHEDULE }}"
    EOF
```

This approach follows security best practices by:
- Keeping sensitive data in GitHub Secrets
- Using Variables for non-sensitive configuration
- Generating tfvars files dynamically in CI/CD
- Preventing sensitive data from being committed to version control