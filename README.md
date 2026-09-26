# AutoNyan

A Google Cloud Functions project demonstrating serverless document processing with TypeScript and Terraform. AutoNyan implements an event-driven pipeline for automated Google Drive document scanning, text extraction using Vision API, and data persistence to Firestore.

> **Using a deployed AutoNyan instance?** See the **[user documentation site](https://kkohtaka.github.io/AutoNyan/)** (available in English and 日本語) for how to drop documents into Drive, read the classified results, and interpret notification emails. This README targets contributors and operators building and deploying the pipeline.

## Architecture Overview

AutoNyan uses an event-driven, serverless architecture on Google Cloud Platform with a 7-stage pipeline:

```mermaid
graph LR
    A[Cloud Scheduler] --> B[1. Drive Discovery]
    B --> C[2. Document Preparation]
    C --> D[3. Text Extraction]
    D --> E[4. Data Persistence]
    E --> G[5. Classification]
    E --> H[6. Calendar Registration]
    E --> F[Firestore]
    A --> R[7. Re-classification Sweep]
    R --> G
    B -.-> N[Notifications]
    C -.-> N
    D -.-> N
    E -.-> N
    G -.-> N
    H -.-> N
```

**Event Flow:** Scheduled trigger → PubSub → Storage events → Storage events → Database → Classification → Calendar Registration, with each stage publishing success/failure events to a notification dispatcher.

### Pipeline Stages

1. **Drive Discovery**: Scheduled scanning of Google Drive folders to discover documents
2. **Document Preparation**: Downloads and copies documents from Google Drive to Cloud Storage
3. **Text Extraction**: Processes documents using Vision API for OCR and text extraction
4. **Data Persistence**: Stores extracted text and metadata in Firestore database
5. **Classification**: Classifies documents with AI and moves them to categorized Drive folders
6. **Calendar Registration**: Extracts events from documents the classifier filed into a mapped category and registers them on the calendar configured for that category
7. **Re-classification Sweep**: Scheduled re-submission of documents left in the Uncategorized folder, once the set of category folders has changed

Calendar registration runs downstream of classification: the category the
classifier decided on is what selects the calendar, so no separate intake folder
per calendar is needed. The classifier publishes the trigger before moving the
file in Drive, so a document still reaches the calendar when the move fails. A
classification below the confidence threshold registers nothing, because events
are never updated or deleted and a misclassification has to be undone by hand.

The re-classification sweep re-enters the pipeline at the classification stage
using the text already in Firestore, so adding a category folder re-files the
documents that were waiting for it without paying for OCR a second time. A
document is reconsidered only when the category folders have changed since it
was last classified.

**Notifications (cross-cutting):** A notification dispatcher consumes success and
failure events published by the pipeline stages and emails summaries to the
relevant Drive folder owner via the Gmail API.

### Event Triggers

- **Scheduled Triggers**: Cloud Scheduler initiates periodic Drive scans and the re-classification sweep
- **PubSub Triggers**: Message-based communication between discovery and preparation stages
- **Storage Triggers**: New file uploads automatically trigger processing stages

### Key Technologies

- **Cloud Functions v2**: Serverless compute with Node.js runtime
- **PubSub**: Asynchronous messaging between pipeline stages
- **Cloud Storage**: Document staging and results storage
- **Vision API**: OCR and text extraction from documents
- **Vertex AI**: Document classification into categories and event extraction
- **Calendar API**: Event registration on per-category calendars
- **Gmail API**: Email notifications via Domain-Wide Delegation
- **Firestore**: NoSQL database for extracted text and metadata
- **Terraform**: Infrastructure as Code for all cloud resources

## Features

- **Event-Driven Architecture**: Fully asynchronous pipeline with automatic retries
- **TypeScript**: Full type safety with strict typing and comprehensive testing
- **Infrastructure as Code**: Terraform modules for reproducible deployments
- **Google Drive Integration**: Advanced Drive API operations with pagination support
- **Document Processing**: Automated scanning and text extraction from multiple file formats
- **AI Classification**: Categorizes documents and files them into Drive folders
- **Calendar Registration**: Registers a document's events on the calendar mapped to its category, without duplicates across re-scans
- **Email Notifications**: Success/failure summaries delivered via the Gmail API
- **Modular Design**: Each function is independently deployable and testable
- **Security-First CI/CD**: GitHub Actions with Workload Identity Federation
- **Dev Container**: Pre-configured development environment with all tools

## Prerequisites

- **Node.js**: Version specified in `.nvmrc` file
- **Google Cloud SDK**: [Installation guide](https://cloud.google.com/sdk/docs/install)
- **Terraform**: Version >= 1.0 ([Download](https://www.terraform.io/downloads.html))
- **Google Cloud Project**: With billing enabled
- **nvm**: Recommended for Node.js version management ([Install nvm](https://github.com/nvm-sh/nvm))
- **Docker**: Required for dev container workflow ([Install Docker](https://www.docker.com/))

## Quick Start

### Option 1: Dev Container (Recommended)

1. Install [VS Code](https://code.visualstudio.com/) and [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open this project in VS Code
3. Reopen in dev container when prompted (or use `Dev Containers: Reopen in Container`)
4. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

### Option 2: Local Development

1. Install prerequisites listed above
2. Install Node.js version from `.nvmrc`:
   ```bash
   nvm install && nvm use
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

### Configuration

#### 1. Terraform Backend Setup

Set up remote state storage in Cloud Storage:

```bash
# Optional: Configure custom bucket name and location
export TF_STATE_BUCKET="your-custom-bucket-name"
export TF_STATE_LOCATION="your-preferred-region"

# Run the setup script
npm run setup:terraform-backend

# Initialize Terraform
npm run terraform:init
```

#### 2. Project Variables

Create an environment-specific variables file (gitignored):

```bash
cp terraform/terraform.tfvars.example terraform/environments/staging.tfvars
```

Edit `terraform/environments/staging.tfvars` with your values:

```hcl
project_id              = "your-gcp-project-id"
environment             = "staging"
region                  = "us-central1"
drive_folder_id         = "your-google-drive-folder-id"
drive_scanner_schedule  = "0 9 * * *"  # Daily at 9 AM UTC
category_root_folder_id = "your-category-root-folder-id"
uncategorized_folder_id = "your-uncategorized-folder-id"
billing_account_id      = "XXXXXX-XXXXXX-XXXXXX"  # for the cost budget
notification_from_email = "admin@your-workspace-domain.com"  # Gmail sender
```

See `terraform/terraform.tfvars.example` for the full set of variables and
their defaults (e.g., `budget_amount`, `budget_alert_thresholds`).

For production, create a separate `terraform/environments/production.tfvars` with `environment = "production"` and production-specific values. Select the environment with the `ENVIRONMENT` variable (defaults to `staging`).

**Finding Your Drive Folder ID:**

- Open Google Drive in your browser
- Navigate to the folder you want to scan
- Copy the ID from the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
- Use `"root"` to scan entire Drive (after sharing)

#### 3. Deploy Infrastructure

```bash
npm run deploy
```

This command builds the functions and deploys all infrastructure via Terraform.

#### 4. Configure Google Drive Access

Drive permissions cannot be expressed in Terraform, so each environment has two Drive identities (a writer and an organizer service account, created by Terraform) that the folders are shared with **once**. Functions borrow one of them at runtime through an IAM binding Terraform owns, so this is an environment bootstrap step — not something to repeat per deployment or per new function. Use the automated setup script:

1. Authenticate with Drive API scope (required once per machine):

   ```bash
   gcloud auth login --enable-gdrive-access
   ```

2. Run the sharing script:

   ```bash
   # For staging (default)
   npm run setup:share-drive-folders

   # For production
   ENVIRONMENT=production \
     DRIVE_FOLDER_ID=your-production-folder-id \
     CATEGORY_ROOT_FOLDER_ID=your-category-root-id \
     UNCATEGORIZED_FOLDER_ID=your-uncategorized-id \
     npm run setup:share-drive-folders
   ```

3. Test the setup:
   ```bash
   # Trigger a manual scan (replace topic name from terraform output)
   gcloud pubsub topics publish SCAN_TRIGGER_TOPIC --message='{"folderId":"YOUR_FOLDER_ID"}'
   ```

**Why Manual Sharing?**
Drive API doesn't support project-level IAM roles. Sharing the folders with two identities that the functions impersonate keeps access explicit and least-privilege, and moves the one manual step to environment bootstrap instead of after every deploy.

#### 5. Share the target calendars (for calendar registration)

Calendar access follows the same explicit-sharing model as Drive: the function
can only reach calendars that have been shared with its service account. This is
a one-time step per calendar, and there is no script for it — the Calendar API
cannot add a sharing rule without calendar-owner rights.

1. Get the registrar's service account address after deployment:

   ```bash
   terraform -chdir=terraform output calendar_registrar_service_account_email
   ```

2. In Google Calendar, open the target calendar's **Settings and sharing** →
   **Share with specific people** and add that address with **Make changes to
   events**.

3. Declare the category-to-calendar mapping in `calendar_category_calendars`
   (see `terraform/terraform.tfvars.example`), or as the
   `CALENDAR_CATEGORY_CALENDARS` Environment Secret in CI. Each `category` is
   the name of a subfolder under `category_root_folder_id`, already shared with
   the pipeline service accounts by step 4 above — calendar registration needs
   no folder of its own.

   `calendar_classification_confidence_threshold` (default `0.7`) sets how sure
   the classifier must be before a document's events are registered.

**Note:** Events created this way cannot send invitations to attendees — that
would require Domain-Wide Delegation rather than calendar sharing.

#### 6. Configure Gmail Domain-Wide Delegation (for notifications)

The notification dispatcher sends email as `notification_from_email` via the
Gmail API, which requires **Domain-Wide Delegation (DWD)** authorized once in
the Google Workspace Admin console. Without this step, notification sending
fails and no emails are delivered.

1. Get the dispatcher service account's client ID after deployment:

   ```bash
   terraform -chdir=terraform output notification_dispatcher_service_account_client_id
   ```

2. In the [Google Workspace Admin console](https://admin.google.com) → **Security
   → Access and data control → API controls → Domain-wide delegation**, add a new
   API client:
   - **Client ID**: the value from step 1
   - **OAuth scopes**: `https://www.googleapis.com/auth/gmail.send`

3. Ensure `notification_from_email` is a real mailbox in that Workspace domain.

> **Note:** DWD can only be configured for a Google Workspace domain. The sender
> address must belong to that domain.

## Development Workflows

### Building & Testing

```bash
# Build all functions
npm run build

# Run tests for all functions
npm test

# Run tests with coverage
npm run test:coverage

# Clean build artifacts
npm run clean
```

**Available test commands:**
See individual function workspaces in `src/functions/*/package.json` for function-specific scripts.

### Code Quality

```bash
# Run all linters and formatters
npm run lint
npm run format

# Check specific file types
npm run lint:ts          # TypeScript linting
npm run lint:yaml        # YAML linting
npm run lint:terraform   # Terraform linting
npm run lint:json        # JSON linting
npm run lint:sh          # Shell script linting
```

**Pre-commit workflow:**
Always run `npm run lint && npm run format` before committing to ensure code quality standards.

### Infrastructure Management

```bash
# Initialize Terraform (first time or after backend changes)
npm run terraform:init

# Preview infrastructure changes
npm run terraform:plan

# Apply infrastructure changes
npm run terraform:apply

# Validate Terraform configuration
npm run terraform:validate

# Destroy all infrastructure (use with caution)
npm run terraform:destroy
```

**Terraform workflow:**

1. Modify infrastructure in `terraform/` or `terraform/modules/`
2. Run `npm run terraform:plan` to preview changes
3. Review the plan carefully
4. Run `npm run terraform:apply` to apply changes
5. Verify resources in Google Cloud Console

### Deployment

**Local Deployment:**

```bash
npm run deploy
```

**CI/CD Deployment:**
The project uses GitHub Actions for automated testing and validation. See [GitHub Actions Setup](#github-actions-cicd-optional) for configuration.

## Project Structure

```
.
├── src/
│   ├── functions/          # Cloud Functions (npm workspaces)
│   │   ├── drive-scanner/
│   │   ├── doc-processor/
│   │   ├── text-vision-processor/
│   │   ├── text-firebase-writer/
│   │   ├── file-classifier/
│   │   ├── calendar-registrar/
│   │   ├── reclassification-sweeper/
│   │   └── notification-dispatcher/
│   └── shared/             # Shared utilities across functions
├── terraform/              # Infrastructure as Code
│   ├── modules/            # Terraform modules (one per function)
│   ├── main.tf
│   ├── variables.tf
│   └── terraform.tfvars.example
├── scripts/                # Build and setup scripts
├── .devcontainer/          # Dev container configuration
├── .github/workflows/      # CI/CD workflows
├── dist/                   # Build output (generated)
├── CLAUDE.md               # AI assistant development guide
├── README.md               # This file
└── package.json            # Root workspace configuration
```

### Architectural Patterns

**npm Workspaces:**
Each Cloud Function is an independent npm workspace with its own dependencies, tests, and configuration. Shared code lives in `src/shared/`.

**Terraform Modules:**
Infrastructure is organized into modules matching the function structure. Each module manages:

- Cloud Function resource
- Service account with least-privilege IAM
- Event triggers (PubSub or Storage)
- Related resources (topics, storage buckets)

**Co-located Tests:**
Tests live alongside implementation code in each function directory, following the pattern `index.test.ts` next to `index.ts`.

## Google Drive Integration

### Supported File Types

AutoNyan can process the following document types:

- **PDF documents**: `.pdf`
- **Microsoft Office**: Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`), PowerPoint (`.ppt`, `.pptx`)
- **Google Workspace**: Docs, Sheets, Slides
- **Text files**: `.txt`, `.rtf`

The system handles folders with unlimited files using pagination.

### Drive Operations

The document pipeline provides these Drive API operations:

- List files with pagination
- Create folders in shared areas
- Move files between folders
- Copy files within accessible areas
- Search files by name and MIME type
- Retrieve folder metadata

### Manual Triggers

Trigger document scanning manually via PubSub:

```bash
# Get the PubSub topic name from Terraform
terraform output -raw drive_scan_topic_name

# Trigger a folder scan
gcloud pubsub topics publish <TOPIC_NAME> --message='{"folderId":"YOUR_FOLDER_ID"}'

# Scan entire accessible Drive
gcloud pubsub topics publish <TOPIC_NAME> --message='{"folderId":"root"}'
```

### Permissions Model

**What the service account CAN do** (in shared folders only):

- List files and folders
- Read file metadata and content
- Create new folders
- Copy files
- Move or trash files — requires the Content Manager (`fileOrganizer`) role
  on the shared drive folders; the sharing script grants it only to the
  classifier and GitHub Actions service accounts (plain Editor/`writer` can
  neither re-parent nor trash items)
- Download documents for processing

**What the service account CANNOT do:**

- Access unshared folders or files
- Delete files or folders
- Modify sharing permissions
- Access other users' private Drive content

## GitHub Actions CI/CD (Optional)

AutoNyan includes a security-first CI/CD pipeline with GitHub Actions.

### Pipeline Security Model

- **Workload Identity Federation**: No service account keys stored in GitHub
- **PR Author Detection**: Different permissions for repository owners vs. Dependabot vs. external contributors
- **Progressive Stages**: Each stage must pass before the next stage runs
- **Manual Override**: Repository owners can trigger infrastructure validation with comments

### Pipeline Stages

1. **Code Quality**: Linting and formatting checks
2. **Testing**: Unit tests and coverage thresholds
3. **Infrastructure Validation**: Terraform plan (auto-triggered for owner PRs)
4. **Build**: Create deployment packages (auto-triggered after successful validation)
5. **Deploy**: Manual or scheduled only (not automatic)

### Configuration

For detailed GitHub Actions setup instructions, see [GITHUB_ACTIONS_SETUP.md](./GITHUB_ACTIONS_SETUP.md).

**Required Variables** (Settings → Secrets and variables → Actions → Variables):

- `TF_STATE_BUCKET`: Terraform state storage bucket
- `TF_STATE_LOCATION`: Cloud Storage bucket location
- `DRIVE_SCANNER_SCHEDULE`: Cron schedule (e.g., `"0 9 * * 1"`)
- `BUDGET_AMOUNT`: Monthly cost budget (optional)

**Required Secrets**:

- `WIF_PROVIDER`: Workload Identity Federation provider
- `WIF_SERVICE_ACCOUNT`: Service account email for GitHub Actions
- `DRIVE_FOLDER_ID`, `CATEGORY_ROOT_FOLDER_ID`, `UNCATEGORIZED_FOLDER_ID`: Drive folder IDs
- `CALENDAR_CATEGORY_CALENDARS` (optional): JSON array mapping classification categories to calendars
- `BILLING_ACCOUNT_ID`: Cloud Billing account ID for the cost budget
- `NOTIFICATION_FROM_EMAIL`: Gmail sender address for notifications

See [GITHUB_ACTIONS_SETUP.md](./GITHUB_ACTIONS_SETUP.md) for the complete list and descriptions.

**Setup command:**

```bash
npm run setup:github-actions
```

## Adding New Functions

To add a new function to the pipeline:

### 1. Create Function Workspace

```bash
mkdir -p src/functions/my-new-function
cd src/functions/my-new-function
npm init -y
```

Set up the workspace structure following existing functions.

### 2. Implement Event Handler

Create `index.ts` with a CloudEvent handler:

```typescript
import { CloudEvent } from '@google-cloud/functions-framework';

export const myNewFunction = async (
  cloudEvent: CloudEvent<YourDataType>
): Promise<Result> => {
  // Your implementation
};
```

### 3. Add Tests

Create `index.test.ts` following the existing test patterns:

- Mock Google Cloud services
- Test with sample CloudEvents
- Achieve coverage thresholds

### 4. Create Terraform Module

Create `terraform/modules/my-new-function/` with:

- Service account and IAM bindings
- Cloud Function resource
- Event trigger configuration (PubSub or Storage)
- Required infrastructure (buckets, topics, etc.)

### 5. Wire Up in Main Configuration

Add the module to `terraform/main.tf` and connect it to the pipeline.

### 6. Build and Deploy

```bash
npm run deploy
```

## Troubleshooting

### Common Issues

**Drive Access Errors:**

- Verify the folder has been shared with the two Drive identities; get their emails from `terraform output drive_writer_service_account_email` and `terraform output drive_organizer_service_account_email`
- Ensure the writer identity holds "Contributor" and the organizer identity "Content manager"
- Wait a few minutes after sharing for permissions to propagate

**Terraform State Lock:**

- Another process may be running Terraform concurrently
- Automatic cleanup on failure is built into CI/CD workflows
- For manual unlock in emergencies, use the GitHub Actions workflow:
  1. Go to Actions → "Unlock Terraform State (Manual)"
  2. Click "Run workflow"
  3. Type "UNLOCK" in the confirmation field
  4. Run the workflow to safely remove the lock
- Local development: `terraform -chdir=terraform force-unlock LOCK_ID`
- The unlock workflow uses the same concurrency group as plan/deploy for safety

**Function Timeout:**

- Check Cloud Functions logs: `gcloud functions logs read FUNCTION_NAME`
- Adjust timeout in the function's Terraform module
- Consider batch size for processing operations

**Build Failures:**

- Ensure Node.js version matches `.nvmrc`
- Run `npm clean` and rebuild
- Check for TypeScript errors: `npm run lint:ts`

### Viewing Logs

```bash
# View function logs
gcloud functions logs read FUNCTION_NAME --region=REGION

# Stream logs in real-time
gcloud functions logs read FUNCTION_NAME --region=REGION --follow

# View logs in Cloud Console
# Navigate to Cloud Functions → Select function → Logs tab
```

### Monitoring

Monitor your pipeline in Google Cloud Console:

- **Cloud Functions**: View invocations, errors, and performance metrics
- **Cloud Storage**: Monitor bucket usage and object counts
- **PubSub**: Track message delivery and subscription backlogs
- **Firestore**: Query stored documents and metadata

## Resources

- [Cloud Functions Documentation](https://cloud.google.com/functions/docs)
- [Terraform Google Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Google Drive API](https://developers.google.com/drive/api/guides/about-sdk)
- [Cloud Vision API](https://cloud.google.com/vision/docs)
- [Firestore Documentation](https://cloud.google.com/firestore/docs)

## Maintaining This Document

**When to update README.md:**

- ✅ **Architecture changes**: When adding/removing pipeline stages or changing the event flow
- ✅ **New major features**: When adding significant new capabilities (e.g., new data sources, new output formats)
- ✅ **Setup process changes**: When prerequisites or configuration steps change
- ✅ **Troubleshooting updates**: When discovering new common issues and solutions

**What NOT to update:**

- ❌ **Specific function names**: Let code/Terraform be the source of truth
- ❌ **Exact command syntax**: Reference `package.json` instead
- ❌ **Version numbers**: Use relative references (e.g., "version in `.nvmrc`")
- ❌ **Implementation details**: Keep focus on concepts and workflows

**Maintenance principle:** Keep documentation high-level and workflow-focused. Implementation details should be discovered from code, not duplicated in documentation.

## Contributing

For development patterns, code conventions, and AI-assisted development guidelines, see [CLAUDE.md](./CLAUDE.md).

## License

This project is provided as-is for demonstration and educational purposes.
