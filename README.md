# AutoNyan

A Google Cloud Functions project built with TypeScript and managed with Terraform. This project demonstrates creating and deploying serverless functions to Google Cloud Platform with infrastructure as code.

## Features

- **Serverless Functions**: Google Cloud Functions v2 with Node.js 20 runtime
- **TypeScript**: Full TypeScript support with strict typing and Jest testing
- **Infrastructure as Code**: Terraform for cloud resource management
- **Google Drive Integration**: Advanced Drive API operations with pagination support
- **Document Scanner**: Automated Google Drive document scanning with PubSub integration
- **Type Safety**: Comprehensive TypeScript types for Google Drive API operations
- **Dev Container**: Pre-configured development environment with linting and formatting

## Prerequisites

- Node.js (version specified in `.nvmrc`)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- [Terraform](https://www.terraform.io/downloads.html) >= 1.0
- A Google Cloud project with billing enabled
- [nvm](https://github.com/nvm-sh/nvm) (recommended for Node.js version management)

## Quick Start

### Option 1: Dev Container (Recommended)

1. Install [Docker](https://www.docker.com/) and [VS Code Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open this project in VS Code
3. Reopen in dev container when prompted (or use `Dev Containers: Reopen in Container`)
4. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```
5. Skip to [Configuration](#configuration)

### Option 2: Local Setup

1. **Install Node.js**:

   ```bash
   # Using nvm (recommended)
   nvm install && nvm use

   # Or install Node.js version from .nvmrc manually
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure Google Cloud**:

   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

4. **Set up GitHub Actions authentication** (for CI/CD):

   ```bash
   npm run setup:github-actions
   ```

5. **Configure GitHub repository variables** (for CI/CD):
   - Go to your GitHub repository Settings > Secrets and variables > Actions > Variables tab
   - Add the following repository variables:
     - `TF_STATE_BUCKET`: Your Terraform state bucket name (e.g., `my-project-terraform-state`)
     - `TF_STATE_LOCATION`: Your preferred region (e.g., `us-central1`)
   - These variables are used by the CI/CD pipeline for Terraform backend configuration

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
  - `doc-processor`: Document processor (512MB memory, 540s timeout, 0-100 instances)

### Storage Resources

- **Cloud Storage Bucket**: Function source code storage (`{project-id}-function-source`)
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
- **IAM Roles**: Storage viewer, service usage consumer, PubSub publisher

### Data Flow Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Cloud Scheduler│    │  PubSub Topic    │    │ drive-scanner   │
│  (Cron Job)     │───▶│ drive-scan-      │───▶│ Cloud Function  │
│                 │    │ trigger          │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  External       │    │  PubSub Topic    │    │ Google Drive    │
│  Consumers      │◀───│ doc-classify-    │◀───│ API             │
│                 │    │ trigger          │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘


┌─────────────────┐    ┌──────────────────┐
│  Cloud Storage  │    │ Service Account  │
│  Bucket         │    │ drive-scanner    │
│  (Source Code)  │    │ (IAM Roles)      │
└─────────────────┘    └──────────────────┘
```

**Flow Description**:

1. **Scheduled Trigger**: Cloud Scheduler publishes messages to `drive-scan-trigger` topic
2. **Drive Scanning**: `drive-scanner` function processes PubSub events, scans Google Drive
3. **Document Processing**: Scanner publishes document metadata to `doc-classify-trigger` topic
4. **External Integration**: Downstream consumers process document classification messages

## Functions

### Drive Scanner

Automated Google Drive document scanning with PubSub integration and advanced file management capabilities.

**Function Name**: `drive-scanner`  
**Entry Point**: `folderScanner`

**Features**:

- **Pagination Support**: Handles folders with unlimited number of files (100+ files)
- **Type Safety**: Full TypeScript typing with Google Drive API v3 schemas
- **File Operations**: List, create, move, copy, and search operations
- **Document Types**: Supports PDF, Word, Excel, PowerPoint, text files, and Google Docs
- **Scheduling**: Configurable cron-based scanning via Cloud Scheduler
- **Integration**: Publishes findings to PubSub topic for downstream processing
- **Security**: Manual folder sharing model for precise access control
- **Logging**: Comprehensive error handling and operation tracking

**Available Drive Operations** (via `driveOperations` export):

- `listFiles()` - List files with pagination support
- `createFolder()` - Create new folders in shared areas
- `moveFile()` - Move files between accessible folders  
- `copyFile()` - Copy files within shared areas
- `getFolderInfo()` - Get detailed folder metadata
- `searchFiles()` - Search files by name with pagination
- `listAllFiles()` - List all accessible files across Drive
- `listFolderContents()` - Enhanced folder listing with MIME type filtering

**Manual trigger**:

```bash
# Trigger via PubSub (recommended for production)
gcloud pubsub topics publish drive-scan-trigger --message='{"folderId":"your-folder-id","topicName":"doc-classify-trigger"}'

# Examples with different folder targets
gcloud pubsub topics publish drive-scan-trigger --message='{"folderId":"root","topicName":"doc-classify-trigger"}'  # Scan entire Drive
gcloud pubsub topics publish drive-scan-trigger --message='{"folderId":"1BxiMVs0XRA5nFMF-FYqen0wBVTGOT4xS","topicName":"doc-classify-trigger"}'  # Specific folder
```

### Document Processor

Processes Google Drive files by copying them to Cloud Storage for further analysis and processing.

**Function Name**: `doc-processor`  
**Entry Point**: `documentScanPreparation`

**Features**:

- **File Download**: Downloads files from Google Drive to Cloud Storage
- **Multiple Formats**: Supports various document types and formats
- **Cloud Storage**: Efficient file management with Cloud Storage integration
- **Event-Driven**: Triggered by PubSub messages containing file metadata
- **Scalable**: Auto-scaling from 0-100 instances based on workload
- **Security**: Dedicated service account with Cloud Storage admin permissions

**Manual trigger**:

```bash
# Trigger document processing via PubSub
gcloud pubsub topics publish doc-process-trigger --message='{"fileId":"your-file-id","fileName":"document.pdf"}'
```
