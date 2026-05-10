import { Storage } from '@google-cloud/storage';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
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

    // Clean up old Drive test artifacts before running tests
    // This covers both legacy e2e-test-* files (direct children) and
    // isolated e2e-run-* subfolders from the current approach
    console.log('Cleaning up old Drive test artifacts...');
    try {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      const drive = google.drive({ version: 'v3', auth });

      const response = await drive.files.list({
        q: `'${config.drive_folder_id}' in parents and (name contains 'e2e-test' or name contains 'e2e-run') and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = response.data.files || [];
      for (const file of files) {
        try {
          await drive.files.delete({
            fileId: file.id!,
            supportsAllDrives: true,
          });
        } catch (err) {
          console.warn(
            `  ⚠️  Failed to delete ${file.name} (${file.id}):`,
            err
          );
        }
      }
      console.log(
        `  ✅ Deleted ${files.length} old test artifact(s) from Drive`
      );
    } catch (error) {
      console.warn(`  ⚠️  Failed to clean Drive artifacts:`, error);
    }

    // Clean up old Storage objects before running tests
    console.log('Cleaning up old Storage objects...');
    const storage = new Storage();

    try {
      await storage
        .bucket(config.document_storage_bucket)
        .deleteFiles({ prefix: 'documents/' });
      console.log(
        `  ✅ Cleaned documents from ${config.document_storage_bucket}`
      );
    } catch (error) {
      console.warn(`  ⚠️  Failed to clean documents bucket:`, error);
    }

    try {
      await storage
        .bucket(config.vision_results_bucket)
        .deleteFiles({ prefix: 'results/' });
      console.log(`  ✅ Cleaned results from ${config.vision_results_bucket}`);
    } catch (error) {
      console.warn(`  ⚠️  Failed to clean results bucket:`, error);
    }

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
