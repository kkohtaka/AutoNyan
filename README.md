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

5. Create a `terraform.tfvars` file in the `terraform` directory with your project details:
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

- `npm run build` - Build TypeScript code
- `npm run build:function` - Build and zip the function
- `npm run terraform:init` - Initialize Terraform (run once)
- `npm run terraform:apply` - Apply Terraform changes
- `npm run terraform:destroy` - Destroy all Terraform-managed resources
- `npm run deploy` - Alias for terraform:apply
- `npm test` - Run tests

## Project Structure

```
.
├── src/
│   └── functions/
│       └── hello/
│           └── index.ts
├── terraform/
│   ├── main.tf
│   ├── backend.tf
│   ├── variables.tf
│   └── setup-backend.sh
├── scripts/
│   └── build-function.sh
├── package.json
├── tsconfig.json
├── .nvmrc
└── README.md
```

## Adding New Functions

1. Create a new function in `src/functions/`
2. Add the function configuration to `terraform/main.tf`
3. Build and deploy using the commands above
