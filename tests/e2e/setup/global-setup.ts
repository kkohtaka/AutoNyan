import { getTerraformOutputs } from '../helpers/terraform-outputs';

export default async function globalSetup(): Promise<void> {
  console.log('\n=== E2E Test Suite - Global Setup ===\n');

  // Set default environment if not set
  if (!process.env.ENVIRONMENT) {
    process.env.ENVIRONMENT = 'staging';
  }

  try {
    // Get configuration from Terraform outputs and tfvars
    const config = await getTerraformOutputs(process.env.ENVIRONMENT);

    // Set environment variables from Terraform configuration if not already set
    if (!process.env.PROJECT_ID && config.project_id) {
      process.env.PROJECT_ID = config.project_id;
    }
    if (!process.env.DRIVE_FOLDER_ID && config.drive_folder_id) {
      process.env.DRIVE_FOLDER_ID = config.drive_folder_id;
    }
    if (
      !process.env.CATEGORY_ROOT_FOLDER_ID &&
      config.category_root_folder_id
    ) {
      process.env.CATEGORY_ROOT_FOLDER_ID = config.category_root_folder_id;
    }
    if (
      !process.env.UNCATEGORIZED_FOLDER_ID &&
      config.uncategorized_folder_id
    ) {
      process.env.UNCATEGORIZED_FOLDER_ID = config.uncategorized_folder_id;
    }

    // Verify required values are now available
    const required = ['PROJECT_ID', 'DRIVE_FOLDER_ID'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required configuration: ${missing.join(', ')}\n` +
          'Please ensure terraform.tfvars is configured or set environment variables.'
      );
    }

    console.log(`Environment: ${process.env.ENVIRONMENT}`);
    console.log(`Project: ${process.env.PROJECT_ID}`);
    console.log(`Drive Folder: ${process.env.DRIVE_FOLDER_ID}`);
    console.log(`Test Start: ${new Date().toISOString()}\n`);
  } catch (error) {
    console.error('Failed to load Terraform configuration:', error);
    throw error;
  }
}
