#!/usr/bin/env tsx

/**
 * Share Google Drive folders with service accounts
 *
 * This script automatically shares configured Drive folders with all
 * environment service accounts that need access. This is a one-time
 * setup step required after initial deployment, since Drive API
 * permissions cannot be managed via Terraform IAM.
 *
 * Run after first deployment to grant service accounts access:
 *   npm run setup:share-drive-folders
 *
 * The script is idempotent - it skips accounts that already have access.
 * You only need to run it again if you:
 *   - Add new service accounts in Terraform
 *   - Need to share additional folders
 *   - Accidentally revoked permissions
 *
 * Environment: Controlled by ENVIRONMENT variable (defaults to staging)
 */

import { google, drive_v3 } from 'googleapis';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TerraformVariables {
  [key: string]: string;
}

interface TerraformOutputs {
  [key: string]: string;
}

interface ShareResult {
  status: 'shared' | 'already_shared' | 'failed';
  email: string;
  error?: string;
}

/**
 * Get Terraform variables from terraform.tfvars
 */
function getTerraformVariables(): TerraformVariables {
  const terraformDir = path.join(process.cwd(), 'terraform');
  const tfvarsPath = path.join(terraformDir, 'terraform.tfvars');

  if (!fs.existsSync(tfvarsPath)) {
    throw new Error(`terraform.tfvars not found at ${tfvarsPath}`);
  }

  const content = fs.readFileSync(tfvarsPath, 'utf-8');
  const variables: TerraformVariables = {};

  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*=\s*"([^"]+)"/);
    if (match) {
      const [, key, value] = match;
      variables[key] = value;
    }
  }

  return variables;
}

/**
 * Get Terraform outputs
 */
function getTerraformOutputs(
  environment: string = 'staging'
): TerraformOutputs {
  const terraformDir = path.join(process.cwd(), 'terraform');

  try {
    const outputJson = execSync(
      `terraform -chdir=${terraformDir} output -json`,
      {
        env: { ...process.env, ENVIRONMENT: environment },
        encoding: 'utf-8',
      }
    );

    const outputs = JSON.parse(outputJson);
    const result: TerraformOutputs = {};

    // Extract service account emails
    for (const [key, value] of Object.entries(outputs)) {
      if (key.includes('service_account_email')) {
        result[key] = (value as any).value;
      }
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get Terraform outputs: ${errorMessage}`);
  }
}

/**
 * Share folder with service account
 */
async function shareFolderWithServiceAccount(
  drive: drive_v3.Drive,
  folderId: string,
  email: string
): Promise<ShareResult> {
  try {
    // Check if permission already exists
    const existingPermissions = await drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(id,emailAddress,role)',
    });

    const alreadyShared = existingPermissions.data.permissions?.some(
      (p) => p.emailAddress === email
    );

    if (alreadyShared) {
      console.log(`  ✓ Already shared with ${email}`);
      return { status: 'already_shared', email };
    }

    // Create new permission
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        type: 'user',
        role: 'writer', // Editor access
        emailAddress: email,
      },
      sendNotificationEmail: false,
    });

    console.log(`  ✅ Shared with ${email}`);
    return { status: 'shared', email };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Failed to share with ${email}: ${errorMessage}`);
    return { status: 'failed', email, error: errorMessage };
  }
}

/**
 * Main function
 */
async function shareDriveFolder(): Promise<void> {
  const environment = process.env.ENVIRONMENT || 'staging';

  console.log('Sharing Google Drive folder with service accounts...\n');
  console.log(`Environment: ${environment}\n`);

  try {
    // Get configuration
    const tfvars = getTerraformVariables();
    const folderId = tfvars.drive_folder_id;
    const projectId = tfvars.project_id;
    const categoryRootFolderId = tfvars.category_root_folder_id;
    const uncategorizedFolderId = tfvars.uncategorized_folder_id;

    if (!folderId) {
      throw new Error('drive_folder_id not found in terraform.tfvars');
    }

    console.log(`Project: ${projectId}`);
    console.log(`Main Drive Folder: ${folderId}`);
    console.log(`Category Root Folder: ${categoryRootFolderId || 'Not set'}`);
    console.log(
      `Uncategorized Folder: ${uncategorizedFolderId || 'Not set'}\n`
    );

    // Get service account emails from Terraform outputs
    console.log('Getting service account emails from Terraform...\n');
    const outputs = getTerraformOutputs(environment);

    const serviceAccounts = Object.values(outputs).filter(
      (email) => email && email.includes('@')
    );

    if (serviceAccounts.length === 0) {
      console.warn('⚠️  No service account emails found in Terraform outputs.');
      console.warn(
        'Make sure your Terraform modules output service account emails.\n'
      );
      console.warn('Expected output names like:');
      console.warn('  - drive_scanner_service_account_email');
      console.warn('  - doc_processor_service_account_email');
      console.warn('  - etc.\n');
      process.exit(1);
    }

    console.log(`Found ${serviceAccounts.length} service accounts:\n`);
    serviceAccounts.forEach((email) => console.log(`  - ${email}`));
    console.log();

    // Initialize Drive API with user credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Share main folder
    console.log('Sharing main Drive folder...\n');
    const mainFolderResults: ShareResult[] = [];
    for (const email of serviceAccounts) {
      const result = await shareFolderWithServiceAccount(
        drive,
        folderId,
        email
      );
      mainFolderResults.push(result);
    }

    // Share category root folder if configured
    if (categoryRootFolderId) {
      console.log('\nSharing category root folder...\n');
      for (const email of serviceAccounts) {
        await shareFolderWithServiceAccount(drive, categoryRootFolderId, email);
      }
    }

    // Share uncategorized folder if configured
    if (uncategorizedFolderId) {
      console.log('\nSharing uncategorized folder...\n');
      for (const email of serviceAccounts) {
        await shareFolderWithServiceAccount(
          drive,
          uncategorizedFolderId,
          email
        );
      }
    }

    // Summary
    console.log('\n=== Summary ===\n');

    const shared = mainFolderResults.filter((r) => r.status === 'shared');
    const alreadyShared = mainFolderResults.filter(
      (r) => r.status === 'already_shared'
    );
    const failed = mainFolderResults.filter((r) => r.status === 'failed');

    console.log(`✅ Newly shared: ${shared.length}`);
    console.log(`✓  Already shared: ${alreadyShared.length}`);
    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.length}`);
      console.log('\nFailed accounts:');
      failed.forEach((f) => console.log(`  - ${f.email}: ${f.error}`));
    }

    console.log(
      '\n✅ Drive folder sharing complete. You can now run E2E tests.\n'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any).code;

    console.error('❌ Failed to share Drive folder\n');
    console.error('Error:', errorMessage);

    if (
      errorMessage.includes('insufficient authentication scopes') ||
      errorCode === 403
    ) {
      console.error('\n⚠️  Authentication scope issue detected!\n');
      console.error('Re-authenticate with Drive API scope to share folders:\n');
      console.error(
        '  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive\n'
      );
    }

    process.exit(1);
  }
}

shareDriveFolder();
