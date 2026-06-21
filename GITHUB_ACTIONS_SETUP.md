# GitHub Actions Setup

Configure these GitHub repository settings for Terraform deployment:

## Variables (Settings → Secrets and variables → Actions → Variables)

- `TF_STATE_BUCKET` - GCS bucket name for Terraform state
- `TF_STATE_LOCATION` - GCS bucket location (used for both state and region)
- `DRIVE_SCANNER_SCHEDULE` - Cron schedule for production (e.g., `0 * * * *`)
- `BUDGET_AMOUNT` - Monthly cost budget (whole units of the billing account's
  currency; optional, defaults to `10000` when unset)

**Environment-specific overrides:** Variables can be overridden per environment
(Settings → Environments → staging/production → Variables). For example, set
`DRIVE_SCANNER_SCHEDULE = 0 9 * * *` in the `staging` environment to use a
different schedule than production.

## Secrets (Settings → Secrets and variables → Actions → Secrets)

Configure the following per environment (staging and production separately):

- `WIF_PROVIDER` - Workload Identity Provider resource name
- `WIF_SERVICE_ACCOUNT` - Service account email for Workload Identity
- `DRIVE_FOLDER_ID` - Google Drive folder ID to scan
- `CATEGORY_ROOT_FOLDER_ID` - Google Drive folder for category subfolders
- `UNCATEGORIZED_FOLDER_ID` - Google Drive folder for uncategorized files
- `BILLING_ACCOUNT_ID` - Cloud Billing account ID (format: `XXXXXX-XXXXXX-XXXXXX`)
  used to create the cost budget
- `NOTIFICATION_FROM_EMAIL` - Google Workspace sender address for processing
  notification emails (requires Domain-Wide Delegation; see README)

## Local Development

Create environment-specific variable files (gitignored):

```bash
# Staging
cp terraform/terraform.tfvars.example terraform/environments/staging.tfvars

# Production
cp terraform/terraform.tfvars.example terraform/environments/production.tfvars
```

Select the target environment with the `ENVIRONMENT` variable (defaults to `staging`):

```bash
ENVIRONMENT=staging npm run terraform:init
ENVIRONMENT=staging npm run terraform:plan

ENVIRONMENT=production npm run terraform:init
ENVIRONMENT=production npm run terraform:plan
```
