# GitHub Actions Setup

Configure these GitHub repository settings for Terraform deployment:

## Variables (Settings → Secrets and variables → Actions → Variables)

- `TF_STATE_BUCKET` - GCS bucket name for Terraform state
- `TF_STATE_LOCATION` - GCS bucket location (used for both state and region)
- `DRIVE_SCANNER_SCHEDULE` - Cron schedule (e.g., `0 * * * *`)

## Secrets (Settings → Secrets and variables → Actions → Secrets)

- `WIF_PROVIDER` - Workload Identity Provider resource name
- `WIF_SERVICE_ACCOUNT` - Service account email for Workload Identity
- `DRIVE_FOLDER_ID` - Google Drive folder ID to scan

## Local Development

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in your values.
