# E2E Tests - AutoNyan Pipeline

End-to-end tests for the complete AutoNyan document processing pipeline, covering all 6 stages from Drive scanning to notification dispatch.

## Overview

The E2E test suite validates the entire pipeline flow:

1. **Drive Scanner** - Discovers documents in Google Drive
2. **Doc Processor** - Downloads and uploads to Cloud Storage
3. **Vision Processor** - Extracts text using Vision API OCR
4. **Firebase Writer** - Stores extracted text in Firestore
5. **File Classifier** - Categorizes documents and moves them in Drive
6. **Notification Dispatcher** - Sends a success notification email for the processed document

## Prerequisites

### 1. GCP Authentication

**Local Development:**

IMPORTANT: E2E tests require Drive API access. You must authenticate with the correct scopes:

```bash
# Authenticate with Drive API scope (required for E2E tests)
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive

# Set project
gcloud config set project YOUR_PROJECT_ID
```

**Test your authentication:**

```bash
npm run test:e2e:check-auth      # Verify ADC is configured
npm run test:e2e:check-drive     # Verify Drive API access
```

**CI/CD:**
Workload Identity Federation is configured automatically in GitHub Actions with all required scopes.

### 2. Infrastructure Deployed

Ensure the staging environment is deployed:

```bash
export ENVIRONMENT=staging
npm run deploy
```

Verify deployment:

```bash
terraform -chdir=terraform output
```

### 3. Terraform Configuration

**The E2E tests automatically read configuration from `terraform/terraform.tfvars`.**

No manual environment variable setup is required if your `terraform.tfvars` is configured correctly (which it should be if `npm run terraform:apply` succeeds).

The tests will automatically use values from `terraform.tfvars` for:

- `project_id`
- `drive_folder_id`
- `category_root_folder_id`
- `uncategorized_folder_id`

**Optional:** You can override these values with environment variables if needed:

```bash
export ENVIRONMENT=staging  # defaults to staging
export PROJECT_ID=override-project-id
export DRIVE_FOLDER_ID=override-folder-id
```

### 4. Google Drive Access

Service accounts must have "Editor" access to the Drive folders. **This is a one-time setup** - once folders are shared, permissions persist across deployments.

**Automatic Sharing (Recommended)**

After deploying infrastructure for the first time, run the setup script to share Drive folders:

```bash
# First, authenticate with Drive API scope (if not already done)
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive

# Share Drive folders with service accounts (one-time setup)
npm run setup:share-drive-folders
```

This script:

- Reads service account emails from Terraform outputs
- Shares the main Drive folder with all service accounts
- Shares category root folder and uncategorized folder (if configured)
- Skips accounts that already have access (idempotent)
- Works for both staging and production environments

**Note**: Once folders are shared, you don't need to run this again unless you:

- Create new service accounts in Terraform
- Need to share additional folders
- Accidentally revoked permissions

**Manual Sharing**

Alternatively, share folders manually:

1. Get service account emails: `terraform -chdir=terraform output`
2. Share the Drive folder with each service account:
   - Open Google Drive
   - Right-click the folder → Share
   - Add service account email as "Editor"
   - Click "Send"

**Verify access:**

```bash
npm run test:e2e:check-drive
```

## Running Tests

### Full Pipeline Test

```bash
npm run test:e2e
```

This runs the complete 6-stage pipeline test with a 25-minute timeout.

### Cleanup Orphaned Resources

If tests fail and leave resources behind:

```bash
npm run test:e2e:cleanup
```

## Test Structure

```
tests/e2e/
├── full-pipeline.e2e.test.ts   # Main pipeline test
├── helpers/                    # Shared utilities
│   ├── auth.ts                # GCP authentication
│   ├── cleanup.ts             # Resource cleanup
│   ├── polling.ts             # Async waiting
│   ├── drive-setup.ts         # Drive operations
│   ├── terraform-outputs.ts   # Infrastructure info
│   ├── logger.ts              # Test logging
│   └── cloud-logs.ts          # Cloud Function logs
├── fixtures/                   # Test data
│   └── sample-documents/      # Sample files
├── jest.config.e2e.js         # Jest configuration
└── setup/                      # Global setup/teardown
```

## Pipeline Stage Timeouts

- **Drive Scanner**: 60 seconds
- **Doc Processor**: 120 seconds (2 minutes)
- **Vision Processor**: 300 seconds (5 minutes) - OCR processing
- **Firebase Writer**: 60 seconds
- **File Classifier**: 120 seconds (2 minutes) - AI classification
- **Notification Dispatcher**: 180 seconds (3 minutes) - log-based verification
- **Full Pipeline**: 1500 seconds (25 minutes)

## What the Test Does

1. **Uploads** a test document to Google Drive
2. **Triggers** the Drive Scanner via PubSub message
3. **Waits** for Doc Processor to upload to `document-storage` bucket
4. **Waits** for Vision API to extract text and save to `vision-results` bucket
5. **Waits** for Firebase Writer to create Firestore document in `extracted_texts` collection
6. **Waits** for File Classifier to add category and move file in Drive
7. **Verifies** the file was moved to the correct category folder
8. **Verifies** the Notification Dispatcher logged `Sent success notification` for the test file
9. **Cleans up** all created resources (Drive files, Storage objects, Firestore docs)

## Debugging Failures

### Check Test Logs

Logs are saved to `tests/e2e/logs/`:

```bash
ls -lt tests/e2e/logs/
cat tests/e2e/logs/full-pipeline-*.log
```

### View Cloud Function Logs

```bash
# View logs for a specific function
gcloud functions logs read staging-drive-scanner --region=us-central1 --limit=50

# Stream logs in real-time
gcloud functions logs read staging-doc-processor --region=us-central1 --follow

# Filter by severity
gcloud functions logs read staging-text-vision-processor --region=us-central1 --filter="severity>=ERROR"
```

### Common Issues

**Authentication Errors:**

- Run `gcloud auth application-default login`
- Verify `PROJECT_ID` environment variable is set
- Check Workload Identity Federation configuration (CI/CD)

**Drive Access Errors:**

- Verify service account has "Editor" access to test folder
- Wait a few minutes after sharing for permissions to propagate
- Check folder ID is correct

**Timeout Errors:**

- Vision API can take 3-5 minutes for OCR processing
- Increase timeout if needed in `jest.config.e2e.js`
- Check Cloud Function logs for actual errors

**Resource Not Found:**

- Verify staging infrastructure is deployed: `terraform output`
- Check bucket names and topic names match Terraform outputs
- Ensure all functions are deployed successfully

### Enable Verbose Logging

Set `verbose: true` in `jest.config.e2e.js` for detailed test output.

## CI/CD Integration

E2E tests run automatically in GitHub Actions:

### Manual Trigger

```bash
gh workflow run e2e-test.yml
```

### Scheduled Runs

Tests run daily at 2 AM UTC via cron schedule.

### After Deployment

Optionally triggered after successful staging deployment.

## Cost Considerations

- **Vision API**: ~$1.50 per 1000 images (text detection)
- **Storage**: Negligible for small test files
- **Firestore**: Minimal reads/writes for single document

To minimize costs:

- Use small test files (< 100KB)
- Run tests manually instead of on every commit
- Scheduled runs: once per day maximum
- Clean up resources automatically after each test

## Test Fixtures

Sample documents are in `fixtures/sample-documents/`:

- `test-document.txt` - Plain text with invoice data
- `test-invoice.pdf` - PDF version (to be created)
- `test-receipt.png` - Image with text (to be created)

See `fixtures/README.md` for instructions on creating PDF and image fixtures.

## Troubleshooting

### Tests Pass Locally But Fail in CI

- Check GitHub Secrets and Environment Variables match
- Verify Workload Identity Federation is configured
- Review GitHub Actions logs for authentication errors

### Tests Hang Indefinitely

- Check if Cloud Functions are actually running
- Verify PubSub subscriptions exist and are active
- Check Cloud Function logs for errors preventing execution

### Cleanup Fails

- Resources may be in use by another test run
- Manually delete resources via Google Cloud Console
- Run `npm run test:e2e:cleanup` after a few minutes

## Support

For issues or questions:

1. Check this README and `plans/END_TO_END_TEST.md`
2. Review Cloud Function logs
3. Check test logs in `tests/e2e/logs/`
4. Verify all prerequisites are met
