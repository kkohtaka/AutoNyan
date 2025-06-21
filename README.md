# AutoNyan

This project demonstrates how to create and deploy Google Cloud Functions using TypeScript and manage the infrastructure with Terraform.

## Prerequisites

- nvm (Node Version Manager)
- Google Cloud SDK
- Terraform
- A Google Cloud project

## Setup

1. Install and use the correct Node.js version using nvm:
```bash
# Install nvm using Homebrew
brew install nvm

# Create nvm's working directory
mkdir ~/.nvm

# Add the following to your ~/.zshrc:
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion

# Restart your terminal or run
source ~/.zshrc

# Install and use the project's Node.js version
nvm install
nvm use
```

2. Install dependencies:
```bash
npm install
```

3. Configure Google Cloud:
```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

4. Set up Terraform state storage:
```bash
# Optional: Configure custom bucket name and location
export TF_STATE_BUCKET="your-custom-bucket-name"
export TF_STATE_LOCATION="your-preferred-region"

# Run the setup script
cd terraform
chmod +x setup-backend.sh
./setup-backend.sh

# Initialize Terraform (only needed once or when backend configuration changes)
npm run terraform:init
```

5. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` and update the values:
```hcl
project_id = "your-project-id"
region     = "us-central1"
```

## Development

1. Build the TypeScript code:
```bash
npm run build
```

2. Test the functions locally:
```bash
npm test
```

## Deployment

1. Deploy the functions:
```bash
npm run deploy
```

This will:
- Build the TypeScript code
- Create a zip file of the function
- Apply the Terraform configuration

## Available Scripts

- `npm run build` - Compile TypeScript to JavaScript in the `dist/` directory
- `npm run build:function` - Build and create a zip archive for deployment (runs TypeScript build + zip creation)
- `npm test` - Run Jest tests for all functions
- `npm run terraform:init` - Initialize Terraform backend (run once per project setup)
- `npm run terraform:apply` - Apply Terraform configuration and deploy functions
- `npm run terraform:destroy` - Destroy all Terraform-managed infrastructure
- `npm run deploy` - Full deployment pipeline (build + terraform apply)

## Development with Dev Container

You can use a pre-configured development environment using [Dev Containers](https://containers.dev/) in VS Code or any compatible editor.

1. Make sure you have [Docker](https://www.docker.com/) and [VS Code Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) installed.
2. Open this project folder in VS Code.
3. When prompted, reopen in the dev container, or use the command palette: `Dev Containers: Reopen in Container`.
4. Once the container is built, authenticate with Google Cloud manually:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```
5. Continue with development as described below (build, test, deploy, etc.).

The devcontainer uses Node.js version specified in `.nvmrc` and includes Terraform and Google Cloud SDK.

## Project Structure

```
.
├── .devcontainer/
│   ├── Dockerfile
│   └── devcontainer.json
├── src/
│   └── functions/
│       └── hello/
│           ├── index.ts
│           └── index.test.ts
├── terraform/
│   ├── main.tf
│   ├── backend.tf
│   ├── backend.hcl
│   ├── variables.tf
│   ├── terraform.tfvars.example
│   └── setup-backend.sh
├── scripts/
│   └── build-function.sh
├── dist/                    # Generated TypeScript build output
├── package.json
├── tsconfig.json
├── jest.config.js
├── .nvmrc
├── CLAUDE.md               # Instructions for Claude Code
└── README.md
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
