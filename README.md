# AutoNyan

A Google Cloud Functions project built with TypeScript and managed with Terraform. This project demonstrates creating and deploying serverless functions to Google Cloud Platform with infrastructure as code.

## Features

- **Serverless Functions**: Google Cloud Functions v2 with Node.js 20 runtime
- **TypeScript**: Full TypeScript support with Jest testing
- **Infrastructure as Code**: Terraform for cloud resource management
- **Dual Triggers**: Functions support both HTTP requests and CloudEvent triggers
- **Document Scanner**: Automated Google Drive document scanning with PubSub integration
- **Dev Container**: Pre-configured development environment

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

### Configuration

1. **Set up Terraform backend**:
   ```bash
   # Optional: Configure custom bucket name and location
   export TF_STATE_BUCKET="your-custom-bucket-name"
   export TF_STATE_LOCATION="your-preferred-region"
   
   # Run the setup script
   cd terraform
   ./setup-backend.sh
   
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
   drive_folder_id = "your-google-drive-folder-id"
   ```

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

**Important Notes:**
- Folder ID format: Always a long alphanumeric string (28+ characters)
- Permissions: The service account needs access to the folder
- Sharing: Make sure the folder is shared with your service account email or is publicly accessible
- Root folder: Use `"root"` as the folder ID to scan the entire Drive

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

## Available Scripts

- `npm run build` - Compile TypeScript to JavaScript in the `dist/` directory
- `npm run build:function` - Build and create a zip archive for deployment (runs TypeScript build + zip creation)
- `npm test` - Run Jest tests for all functions
- `npm run terraform:init` - Initialize Terraform backend (run once per project setup)
- `npm run terraform:apply` - Apply Terraform configuration and deploy functions
- `npm run terraform:destroy` - Destroy all Terraform-managed infrastructure
- `npm run deploy` - Full deployment pipeline (build + terraform apply)


## Project Structure

```
.
├── .devcontainer/           # Dev container configuration
├── src/functions/           # Cloud Functions source code
│   ├── hello/              # Sample HTTP/CloudEvent function
│   └── drive-document-scanner/  # Drive scanning function
├── terraform/              # Infrastructure as code
│   ├── main.tf            # Main Terraform configuration
│   ├── variables.tf       # Variable definitions
│   ├── terraform.tfvars.example  # Example configuration
│   └── setup-backend.sh   # Backend setup script
├── scripts/               # Build and deployment scripts
├── dist/                  # Compiled TypeScript output
├── CLAUDE.md             # AI assistant instructions
└── [config files]        # package.json, tsconfig.json, etc.
```

## Adding New Functions

1. Create a new directory: `src/functions/{function-name}/`
2. Implement function in `index.ts` following the dual HTTP/CloudEvent pattern:
   ```typescript
   export const functionName = async (req: Request | CloudEvent<DataType>, res?: Response) => {
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

## Functions

### Hello Function
A sample function demonstrating dual HTTP/CloudEvent support for testing and learning.

### Drive Document Scanner
Automated Google Drive document scanning with PubSub integration.

**Features**:
- Scheduled scanning (hourly via Cloud Scheduler)
- Supports PDF, Word, Excel, PowerPoint, text files, and Google Docs
- Publishes findings to PubSub topic for downstream processing
- Comprehensive logging and error handling

**Manual trigger**:
```bash
curl -X POST "https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/drive-document-scanner" \
  -H "Content-Type: application/json" \
  -d '{"folderId": "your-folder-id", "topicName": "document-classification"}'
```
