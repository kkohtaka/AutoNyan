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
  status: 'shared' | 'already_shared' | 'role_updated' | 'failed';
  email: string;
  error?: string;
}

type DriveRole = 'writer' | 'fileOrganizer';

/**
 * Folders live on a shared drive, where moving items requires the
 * fileOrganizer (Content Manager) role — writer/Contributor can edit files
 * but not re-parent them. Only the classifier moves files, so it alone gets
 * fileOrganizer; every other account keeps least-privilege writer.
 */
function roleForServiceAccount(email: string): DriveRole {
  return email.includes('file-classifier') ? 'fileOrganizer' : 'writer';
}

/**
 * Get Terraform variables from terraform.tfvars
 */
function getTerraformVariables(): TerraformVariables {
  const environment = process.env.ENVIRONMENT || 'staging';
  const terraformDir = path.join(process.cwd(), 'terraform');
  const tfvarsPath = path.join(
    terraformDir,
    'environments',
    `${environment}.tfvars`
  );

  if (!fs.existsSync(tfvarsPath)) {
    throw new Error(
      `terraform.tfvars not found at ${tfvarsPath}\n` +
        `Run: npm run setup:terraform-variables with ENVIRONMENT=${environment}`
    );
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
  const role = roleForServiceAccount(email);

  try {
    // Check if permission already exists
    const existingPermissions = await drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(id,emailAddress,role)',
      supportsAllDrives: true,
    });

    const existing = existingPermissions.data.permissions?.find(
      (p) => p.emailAddress === email
    );

    if (existing) {
      if (existing.role === role) {
        console.log(`  ✓ Already shared with ${email} (${role})`);
        return { status: 'already_shared', email };
      }

      await drive.permissions.update({
        fileId: folderId,
        permissionId: existing.id!,
        requestBody: { role },
        supportsAllDrives: true,
      });

      console.log(
        `  ✅ Updated role for ${email}: ${existing.role} → ${role}`
      );
      return { status: 'role_updated', email };
    }

    // Create new permission
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email,
      },
      sendNotificationEmail: false,
      supportsAllDrives: true,
    });

    console.log(`  ✅ Shared with ${email} (${role})`);
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
    // Get configuration - env vars take precedence over tfvars to support multi-environment runs
    const tfvars = getTerraformVariables();
    const folderId = process.env.DRIVE_FOLDER_ID || tfvars.drive_folder_id;
    const projectId = tfvars.project_id;
    const categoryRootFolderId =
      process.env.CATEGORY_ROOT_FOLDER_ID || tfvars.category_root_folder_id;
    const uncategorizedFolderId =
      process.env.UNCATEGORIZED_FOLDER_ID || tfvars.uncategorized_folder_id;

    if (!folderId) {
      throw new Error(
        'drive_folder_id not found. Set DRIVE_FOLDER_ID env var or add it to terraform.tfvars'
      );
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

    // Always include GitHub Actions service account for E2E tests in CI
    const githubActionsEmail = `github-actions-terraform@${projectId}.iam.gserviceaccount.com`;
    serviceAccounts.push(githubActionsEmail);
    console.log('Including GitHub Actions service account for E2E tests\n');

    console.log(`Found ${serviceAccounts.length} service accounts:\n`);
    serviceAccounts.forEach((email) => console.log(`  - ${email}`));
    console.log();

    // Initialize Drive API using gcloud user credentials (supports --enable-gdrive-access)
    // ADC with Drive scope is blocked by Google for unverified apps, so we use the gcloud token directly
    let accessToken: string;
    try {
      accessToken = execSync('gcloud auth print-access-token', {
        encoding: 'utf-8',
      }).trim();
    } catch {
      throw new Error(
        'Failed to get gcloud access token.\n' +
          'Run: gcloud auth login --enable-gdrive-access'
      );
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

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
    const roleUpdated = mainFolderResults.filter(
      (r) => r.status === 'role_updated'
    );
    const alreadyShared = mainFolderResults.filter(
      (r) => r.status === 'already_shared'
    );
    const failed = mainFolderResults.filter((r) => r.status === 'failed');

    console.log(`✅ Newly shared: ${shared.length}`);
    console.log(`✅ Role updated: ${roleUpdated.length}`);
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
      errorMessage.includes('gcloud access token') ||
      errorCode === 403
    ) {
      console.error('\n⚠️  Authentication issue detected!\n');
      console.error('Re-authenticate with Drive access enabled:\n');
      console.error('  gcloud auth login --enable-gdrive-access\n');
    }

    process.exit(1);
  }
}

shareDriveFolder();
