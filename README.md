# AutoNyan

A Google Cloud Functions project built with TypeScript and managed with Terraform. This project demonstrates creating and deploying serverless functions to Google Cloud Platform with infrastructure as code.

## Features

- **Serverless Functions**: Google Cloud Functions v2 with Node.js 20 runtime
- **TypeScript**: Full TypeScript support with strict typing and Jest testing
- **Infrastructure as Code**: Terraform for cloud resource management
- **Google Drive Integration**: Advanced Drive API operations with pagination support
- **Document Processing**: Automated Google Drive document scanning and processing
- **Text Extraction**: Vision API integration for OCR and text extraction from documents
- **Data Storage**: Firestore integration for storing extracted text and metadata
- **Type Safety**: Comprehensive TypeScript types for all API operations
- **Dev Container**: Pre-configured development environment with linting and formatting

## Prerequisites

- Node.js (version specified in `.nvmrc`)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- [Terraform](https://www.terraform.io/downloads.html) >= 1.0
- A Google Cloud project with billing enabled
- [nvm](https://github.com/nvm-sh/nvm) (recommended for Node.js version management)

## Quick Start

1. Install [Docker](https://www.docker.com/) and [VS Code Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open this project in VS Code
3. Reopen in dev container when prompted (or use `Dev Containers: Reopen in Container`)
4. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

### Configuration

1. **Set up Terraform backend**:

   ```bash
   # Optional: Configure custom bucket name and location
   export TF_STATE_BUCKET="your-custom-bucket-name"
   export TF_STATE_LOCATION="your-preferred-region"

   # Run the setup script
   npm run setup:terraform-backend

   # Initialize Terraform
   npm run terraform:init
   ```

2. **Configure project variables**:

   ```bash
   cp terraform/terraform.tfvars.example terraform/terraform.tfvars
   ```

   Edit `terraform/terraform.tfvars`:

   ```hcl
   project_id = "your-project-id"
   region     = "us-central1"
   drive_folder_id = "your-google-drive-folder-id"  # See Google Drive Setup section below
   ```

3. **Configure GitHub Actions CI/CD** (if using GitHub repository):

   For the CI/CD pipeline to work properly, you need to configure GitHub repository variables and secrets:

   **Repository Variables** (Settings > Secrets and variables > Actions > Variables):
   - `TF_STATE_BUCKET`: Terraform state storage bucket name
   - `TF_STATE_LOCATION`: Cloud Storage bucket region/location
   - `DRIVE_FOLDER_ID`: Google Drive folder ID for scanning
   - `DRIVE_SCANNER_SCHEDULE`: Cron schedule for automatic scanning (e.g., "0 9 * * 1")

   **Repository Secrets** (Settings > Secrets and variables > Actions > Secrets):
   - `WIF_PROVIDER`: Workload Identity Federation provider (set up via `npm run setup:github-actions`)
   - `WIF_SERVICE_ACCOUNT`: Service account email for GitHub Actions authentication
   - `DRIVE_FOLDER_ID`: Google Drive folder ID (if sensitive)

   ### GitHub Actions Workflow Pipeline

   The project uses a secure, multi-stage CI/CD pipeline:

   **For Repository Owner PRs:**
   1. **Test Workflow**: Runs linting and tests on all code changes
   2. **Terraform Plan Workflow**: Validates infrastructure changes (auto-triggered after Test success)
   3. **Build Workflow**: Builds deployment packages (auto-triggered after Terraform Plan success)

   **For Dependabot PRs:**
   - Only runs Test workflow (secure by default, no infrastructure access)
   - Manual infrastructure validation via `/terraform plan` comment (repository owners only)

   **Manual Triggers:**
   - Comment `/terraform plan` on any PR to manually run Terraform validation
   - Only repository owners, members, and collaborators can trigger manual validation

## Google Drive Setup

### Finding Your Google Drive Folder ID

To configure the `drive_folder_id` variable, you need to find the ID of the Google Drive folder you want to scan:

**Method 1: From Google Drive Web Interface (Easiest)**

1. Open Google Drive in your web browser (drive.google.com)
2. Navigate to the folder you want to scan
3. Look at the URL in your browser's address bar
4. The folder ID is the long string after `/folders/`

**Example URL:**

```
https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMF-FYqen0wBVTGOT4xS
```

**Folder ID:** `1BxiMVs0XRA5nFMF-FYqen0wBVTGOT4xS`

**Method 2: Right-click Share Option**

1. Right-click on the folder in Google Drive
2. Select "Share" or "Get link"
3. Copy the shareable link
4. Extract the folder ID from the link (same format as above)

### Granting Drive Access to Service Account

**IMPORTANT**: Google Drive access requires manual folder sharing, as Drive API roles cannot be assigned at the project level.

1. **Deploy the infrastructure first**:
   ```bash
   npm run deploy
   ```

2. **Get the service account email**:
   ```bash
   terraform output service_account_email
   ```

3. **Share your Drive folders**:
   - Open Google Drive (https://drive.google.com)
   - Right-click "My Drive" (for full access) or specific folders
   - Select "Share" 
   - Add the service account email as an "Editor"
   - Click "Send"

4. **Test the setup**:
   ```bash
   # Trigger a manual scan
   gcloud pubsub topics publish drive-scan-trigger --message='{"folderId":"your-folder-id","topicName":"doc-classify-trigger"}'
   ```

**Folder ID Options:**

- **Specific folder**: Use the folder ID from the URL (28+ character alphanumeric string)
- **Entire Drive**: Use `"root"` as the folder ID to scan all accessible content
- **Multiple folders**: Share multiple folders individually with the service account

**Permissions Summary:**

✅ **Allowed Operations** (once shared):
- List files and folders (in shared areas only)
- Create new folders (in shared areas only) 
- Move files between folders (within shared areas)
- Copy files (within shared areas)
- Read file metadata

❌ **Restricted Operations**:
- Access unshared folders
- Delete files or folders
- Manage sharing permissions

## Development

**Build and test**:

```bash
npm run build    # Compile TypeScript
npm test         # Run Jest tests
```

**Deploy to Google Cloud**:

```bash
npm run deploy   # Build + Terraform apply
```

This will build the TypeScript code, create deployment packages, and apply the Terraform configuration.

### CI/CD Workflow Security

The project implements a security-first approach to CI/CD:

- **Dependabot PRs**: Automatically limited to testing only, no access to Google Cloud credentials
- **Repository Owner PRs**: Full pipeline access with automatic Terraform validation after tests pass
- **Manual Override**: Use `/terraform plan` comment to manually validate infrastructure on any PR
- **Staged Pipeline**: Each workflow stage must succeed before proceeding to the next

This ensures that automated dependency updates are secure while maintaining full validation capabilities for code changes.

## Available Scripts

### Build and Test

- `npm run build` - Compile TypeScript to JavaScript in the `dist/` directory
- `npm run build:function` - Build and create a zip archive for deployment
- `npm test` - Run Jest tests for all functions

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

- `npm run terraform:init` - Initialize Terraform backend
- `npm run terraform:apply` - Apply Terraform configuration and deploy functions
- `npm run terraform:plan` - Generate execution plan for Terraform changes
- `npm run terraform:validate` - Validate Terraform configuration
- `npm run terraform:destroy` - Destroy all Terraform-managed infrastructure
- `npm run deploy` - Full deployment pipeline (build + terraform apply)

### Setup

- `npm run setup:github-actions` - Configure GitHub Actions authentication

## Project Structure

```
.
├── .devcontainer/           # Dev container configuration
├── src/functions/           # Cloud Functions source code
│   └── drive-scanner/           # Drive scanning function
├── terraform/              # Infrastructure as code
│   ├── main.tf            # Main Terraform configuration
│   ├── variables.tf       # Variable definitions
│   └── terraform.tfvars.example  # Example configuration
├── scripts/               # Build and deployment scripts
├── dist/                  # Compiled TypeScript output
├── CLAUDE.md             # AI assistant instructions
└── [config files]        # package.json, tsconfig.json, etc.
```

## Adding New Functions

1. Create a new directory: `src/functions/{function-name}/`
2. Implement function in `index.ts` following the dual HTTP/CloudEvent pattern:
   ```typescript
   export const functionName = async (
     req: Request | CloudEvent<DataType>,
     res?: Response
   ) => {
     if (res) {
       // HTTP request handling
     } else {
       // CloudEvent handling
     }
   };
   ```
3. Add corresponding test file `index.test.ts` with both execution path coverage
4. Add Terraform resource configuration in `terraform/main.tf`
5. Build and deploy using the commands above

Functions support both HTTP requests and CloudEvent triggers, with tests covering both execution paths using Jest with ts-jest preset.

## Google Cloud Resources

AutoNyan provisions the following Google Cloud resources via Terraform:

### Compute Resources

- **Cloud Functions v2**: Serverless Node.js 20 runtime functions
  - `drive-scanner`: Drive scanner (512MB memory, 300s timeout, 0-10 instances)
  - `doc-processor`: Document processor (512MB memory, 300s timeout, 0-10 instances)
  - `text-vision-processor`: Vision API text extraction (1GB memory, 540s timeout, 0-10 instances)
  - `text-firebase-writer`: Firestore data writer (512MB memory, 300s timeout, 0-10 instances)

### Storage Resources

- **Cloud Storage Buckets**: 
  - `{project-id}-function-source`: Function source code storage
  - `{project-id}-document-storage`: Document file storage for processing
  - `{project-id}-vision-results`: Vision API results storage
- **Storage Objects**: Zip archives containing built function code

### Messaging & Scheduling

- **PubSub Topics**:
  - `drive-scan-trigger`: Triggers scheduled drive scans
  - `doc-process-trigger`: Triggers document processing
  - `doc-classify-trigger`: Receives document metadata for processing
- **Cloud Scheduler**: Automated folder scanning (configurable cron schedule)

### Identity & Access

- **Service Accounts**: 
  - `drive-scanner-sa`: Drive scanning with least-privilege permissions
  - `doc-processor-sa`: Document processing with Cloud Storage access
  - `text-vision-processor`: Vision API processing with ML developer role
  - `text-firebase-writer`: Firestore data writing with datastore user role
- **IAM Roles**: Storage viewer/admin, service usage consumer, PubSub publisher, ML developer, datastore user
