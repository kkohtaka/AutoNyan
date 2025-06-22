# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoNyan is a Google Cloud Functions project built with TypeScript and managed with Terraform. The project demonstrates creating and deploying serverless functions to Google Cloud Platform with infrastructure as code.

## Common Commands

### Build and Test
- `npm run build` - Compile TypeScript to JavaScript in the `dist/` directory
- `npm test` - Run Jest tests for all functions
- `npm run build:function` - Build and create a zip archive for deployment (runs TypeScript build + zip creation)

### Terraform Operations
- `npm run terraform:init` - Initialize Terraform backend (run once per project setup)
- `npm run terraform:apply` - Apply Terraform configuration and deploy functions
- `npm run terraform:destroy` - Destroy all Terraform-managed infrastructure
- `npm run deploy` - Full deployment pipeline (build + terraform apply)

### Development Setup
- `nvm install && nvm use` - Install and use the correct Node.js version from `.nvmrc`
- `npm install` - Install dependencies
- Terraform setup requires creating `terraform/terraform.tfvars` with `project_id` and `region`

## Architecture and Code Patterns

### Function Structure
- Functions are organized in `src/functions/{function-name}/` directories
- Each function has its own `index.ts` for the main implementation
- Tests are co-located as `index.test.ts` in the same directory
- Functions support both HTTP requests and CloudEvent triggers

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
- Functions are configured with 256MB memory, 60-second timeout, and auto-scaling from 0-100 instances

## Adding New Functions

1. Create new directory: `src/functions/{function-name}/`
2. Implement function following the established pattern with dual HTTP/CloudEvent support
3. Add corresponding test file with both execution path coverage
4. Add Terraform resource configuration in `terraform/main.tf`
5. Update build script if custom zip requirements needed

## Development Environment

Project supports both local development and dev container environments. The dev container includes Node.js (version from `.nvmrc`), Terraform, and Google Cloud SDK pre-installed.