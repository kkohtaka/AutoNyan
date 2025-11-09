# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoNyan is a Google Cloud Functions project built with TypeScript and managed with Terraform. The project demonstrates creating and deploying serverless functions to Google Cloud Platform with infrastructure as code, featuring Google Drive integration, document scanning, and automated CI/CD workflows.

## Common Commands

### Build and Test
- `npm run build` - Compile TypeScript to JavaScript in the `dist/` directory
- `npm test` - Run Jest tests for all functions
- `npm run build:function` - Build and create a zip archive for deployment (runs TypeScript build + zip creation)

### Linting and Formatting
- `npm run lint` - Run all linters (TypeScript, YAML, Terraform)
- `npm run lint:ts` - Run ESLint on TypeScript files with auto-fix
- `npm run lint:yaml` - Run yamllint on GitHub workflows
- `npm run lint:terraform` - Run terraform fmt check and TFLint
- `npm run format` - Format all code (TypeScript, YAML, and Terraform)
- `npm run format:ts` - Format TypeScript files with Prettier
- `npm run format:yaml` - Format YAML files with Prettier
- `npm run format:terraform` - Format Terraform files

### Terraform Operations
- `npm run terraform:init` - Initialize Terraform backend (run once per project setup)
- `npm run terraform:apply` - Apply Terraform configuration and deploy functions
- `npm run terraform:plan` - Generate execution plan for Terraform changes
- `npm run terraform:validate` - Validate Terraform configuration
- `npm run terraform:destroy` - Destroy all Terraform-managed infrastructure
- `npm run deploy` - Full deployment pipeline (build + terraform apply)

### Setup and Configuration
- `npm run setup:github-actions` - Configure GitHub Actions authentication with Workload Identity Federation
- `npm run setup:terraform-backend` - Set up Terraform backend with Cloud Storage bucket

### Development Setup
- `nvm install && nvm use` - Install and use the correct Node.js version from `.nvmrc`
- `npm install` - Install dependencies
- `gcloud auth application-default login` - Authenticate with Google Cloud
- `npm run setup:terraform-backend` - Configure Terraform backend storage
- `npm run terraform:init` - Initialize Terraform backend
- Create `terraform/terraform.tfvars` with `project_id`, `region`, and `drive_folder_id`

## Architecture and Code Patterns

### Function Structure
- Functions are organized in `src/functions/{function-name}/` directories
- Each function has its own `index.ts` for the main implementation
- Tests are co-located as `index.test.ts` in the same directory
- Functions support both HTTP requests and CloudEvent triggers
- Current functions include `drive-document-scanner` for Google Drive integration

### Function Implementation Pattern
Functions should follow this signature pattern from `src/functions/hello/index.ts:8`:
```typescript
export const functionName = async (req: Request | CloudEvent<DataType>, res?: Response) => {
  if (res) {
    // HTTP request handling
  } else {
    // CloudEvent handling
  }
};
```

### Testing Strategy
- Use Jest with ts-jest preset for TypeScript testing
- Mock Express Request/Response objects for HTTP function testing
- Create CloudEvent objects for event-driven function testing
- Tests cover both HTTP and CloudEvent execution paths

### Build and Deployment
- TypeScript compiles to `dist/` directory with CommonJS modules targeting ES2020
- `scripts/build-function.sh` handles the build-and-zip process for deployment
- Terraform manages Google Cloud infrastructure including:
  - Cloud Functions v2 with Node.js 20 runtime
  - Storage buckets for function source code
  - IAM policies for function access

### Infrastructure Management
- Terraform state is stored in Google Cloud Storage backend
- Infrastructure definitions in `terraform/main.tf` include function configuration, storage, and IAM
- Functions are configured with 512MB memory, 300-second timeout, and auto-scaling from 0-10 instances
- Includes PubSub topics for messaging, Cloud Scheduler for automation, and Service Accounts for security

## Adding New Functions

1. Create new directory: `src/functions/{function-name}/`
2. Implement function following the established pattern with dual HTTP/CloudEvent support
3. Add corresponding test file with both execution path coverage
4. Add Terraform resource configuration in `terraform/main.tf`
5. Update build script if custom zip requirements needed

## Development Environment

Project supports both local development and dev container environments. The dev container includes Node.js (version from `.nvmrc`), Terraform, Google Cloud SDK, yamllint, and TFLint pre-installed.

### IDE Configuration
The devcontainer is configured with VS Code extensions and settings for automatic linting and formatting:
- **ESLint**: Automatic TypeScript linting with auto-fix on save
- **Prettier**: Code formatting on save for TypeScript, JavaScript, JSON
- **YAML**: Validation and formatting for workflow files  
- **Terraform**: Validation and formatting for infrastructure files
- **Auto-cleanup**: Trim whitespace and ensure final newlines

Use Ctrl+Shift+P → "Tasks: Run Task" to access lint and format commands.

## GitHub Actions CI/CD Pipeline

The project implements a security-first CI/CD approach with automated workflows:

### Pipeline Stages
1. **Test Workflow**: Runs linting and tests on all code changes
2. **Terraform Plan Workflow**: Validates infrastructure changes (auto-triggered after Test success for owner and Dependabot PRs)
3. **Build Workflow**: Builds deployment packages (auto-triggered after Terraform Plan success)

### Security Features
- **Dependabot PRs**: Auto-triggered through full pipeline with smart detection - Terraform plan only runs if infrastructure-related files are changed
- **Owner PRs**: Full pipeline access with automatic progression through stages
- **Manual Override**: Comment `/terraform plan` on any PR to manually validate infrastructure
- **Smart Detection**: Terraform plan automatically skips when only non-infrastructure files (docs, workflows, IDE config) are changed
- **Workload Identity Federation**: Secure authentication without storing service account keys

### Configuration Requirements
Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):
- `TF_STATE_BUCKET`: Terraform state storage bucket name
- `TF_STATE_LOCATION`: Cloud Storage bucket region/location
- `DRIVE_FOLDER_ID`: Google Drive folder ID for scanning
- `DRIVE_SCANNER_SCHEDULE`: Cron schedule for automatic scanning

Set these GitHub repository secrets:
- `WIF_PROVIDER`: Workload Identity Federation provider
- `WIF_SERVICE_ACCOUNT`: Service account email for GitHub Actions

## Google Drive Integration

### Setup Requirements
1. Deploy infrastructure: `npm run deploy`
2. Get service account email: `terraform output service_account_email`
3. Share Google Drive folders with the service account as "Editor"
4. Configure `drive_folder_id` in `terraform/terraform.tfvars`

### Drive Operations Available
The `drive-document-scanner` function provides comprehensive Drive API operations:
- `listFiles()` - List files with pagination support
- `createFolder()` - Create new folders in shared areas
- `moveFile()` - Move files between accessible folders
- `copyFile()` - Copy files within shared areas
- `getFolderInfo()` - Get detailed folder metadata
- `searchFiles()` - Search files by name with pagination
- `listAllFiles()` - List all accessible files across Drive
- `listFolderContents()` - Enhanced folder listing with MIME type filtering

### Manual Triggers
```bash
# Trigger folder scan via PubSub
gcloud pubsub topics publish folder-scan-trigger --message='{"folderId":"your-folder-id","topicName":"document-classification"}'

# Scan entire Drive
gcloud pubsub topics publish folder-scan-trigger --message='{"folderId":"root","topicName":"document-classification"}'
```

### Supported File Types
- PDF, Word, Excel, PowerPoint documents
- Text files and Google Docs/Sheets/Slides
- Handles folders with unlimited files (100+ files with pagination)

## Git Workflow Rules

### Branch Management
1. **Never develop directly on master branch** - Always create a new branch for features or bug fixes
2. **Branch naming conventions**:
   - Features: `feature/description` or `feat/description`
   - Bug fixes: `fix/description` or `bugfix/description`
   - Example: `git checkout -b feature/add-email-notifications`

### Pre-commit Requirements
1. **Always run linters and formatters before committing**:
   ```bash
   npm run lint     # Run all linters (TypeScript, YAML, Terraform)
   npm run format   # Format all code (TypeScript, YAML, Terraform)
   ```
2. **Verify all linting passes** before creating commits
3. **Run tests** to ensure code quality: `npm test`

### Recommended Workflow
```bash
# 1. Create and switch to new branch
git checkout -b feature/your-feature-name

# 2. Make your changes
# ... develop your feature ...

# 3. Run quality checks before committing
npm run lint
npm run format
npm test

# 4. Stage and commit changes
git add .
git commit -m "feat: add your feature description"

# 5. Push branch and create PR
git push -u origin feature/your-feature-name
```