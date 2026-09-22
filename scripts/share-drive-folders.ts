#!/usr/bin/env tsx

/**
 * Share Google Drive folders with the environment's Drive identities
 *
 * Drive permissions cannot be managed through Terraform IAM, so this is an
 * environment bootstrap step (the same class as setting up the Terraform
 * backend): it shares the configured folders with the two Drive identities
 * that Terraform creates per environment, plus the CI account. Functions do
 * not hold Drive access themselves; they impersonate one of the identities,
 * so adding a function never requires re-running this script.
 *
 *   npm run setup:share-drive-folders
 *
 * The script is idempotent - it skips grants that already exist. Re-run it
 * only after adding a folder or if a share was revoked by hand.
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

interface ShareResult {
  status: 'shared' | 'already_shared' | 'role_updated' | 'failed';
  email: string;
  error?: string;
}

/**
 * Folders live on a shared drive, where writer/Contributor can edit files
 * but can neither re-parent nor trash them; those need the fileOrganizer
 * (Content Manager) role.
 */
type DriveRole = 'writer' | 'fileOrganizer';

interface Grantee {
  email: string;
  role: DriveRole;
}

interface DriveIdentities {
  writer: string;
  organizer: string;
}

const DRIVE_WRITER_OUTPUT = 'drive_writer_service_account_email';
const DRIVE_ORGANIZER_OUTPUT = 'drive_organizer_service_account_email';

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
 * Fail unless the working directory is initialized against the environment
 * being shared.
 *
 * `terraform output` reads whichever state the last `terraform init` selected
 * and ignores ENVIRONMENT entirely, so an environment mismatch pairs one
 * environment's folder IDs with another's service accounts and grants Drive
 * access across the boundary.
 */
function assertBackendMatchesEnvironment(
  terraformDir: string,
  environment: string
): void {
  const backendStatePath = path.join(
    terraformDir,
    '.terraform',
    'terraform.tfstate'
  );

  if (!fs.existsSync(backendStatePath)) {
    throw new Error(
      `Terraform is not initialized.\n` +
        `Run: ENVIRONMENT=${environment} npm run terraform:init`
    );
  }

  const prefix = JSON.parse(fs.readFileSync(backendStatePath, 'utf-8'))?.backend
    ?.config?.prefix;

  if (prefix !== `terraform/state/${environment}`) {
    throw new Error(
      `Terraform is initialized for "${prefix}", not for ${environment}.\n` +
        `Run: ENVIRONMENT=${environment} npm run terraform:init`
    );
  }
}

/**
 * Read the two Drive identity emails from the Terraform outputs.
 *
 * The identities are named explicitly rather than discovered by output-key
 * pattern: a discovery heuristic cannot tell a missing grant from a module
 * that simply forgot to export its account.
 */
function getDriveIdentities(environment: string = 'staging'): DriveIdentities {
  const terraformDir = path.join(process.cwd(), 'terraform');

  assertBackendMatchesEnvironment(terraformDir, environment);

  let outputs: Record<string, { value?: unknown }>;
  try {
    outputs = JSON.parse(
      execSync(`terraform -chdir=${terraformDir} output -json`, {
        env: { ...process.env, ENVIRONMENT: environment },
        encoding: 'utf-8',
      })
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get Terraform outputs: ${errorMessage}`);
  }

  const readEmail = (key: string): string => {
    const value = outputs[key]?.value;
    if (typeof value !== 'string' || !value.includes('@')) {
      throw new Error(
        `Terraform output "${key}" is missing.\n` +
          `Apply the drive-access module first: ENVIRONMENT=${environment} npm run terraform:apply`
      );
    }
    return value;
  };

  return {
    writer: readEmail(DRIVE_WRITER_OUTPUT),
    organizer: readEmail(DRIVE_ORGANIZER_OUTPUT),
  };
}

/**
 * Share folder with a grantee at its role
 */
async function shareFolderWithGrantee(
  drive: drive_v3.Drive,
  folderId: string,
  { email, role }: Grantee
): Promise<ShareResult> {
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

      console.log(`  ✅ Updated role for ${email}: ${existing.role} → ${role}`);
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

  console.log('Sharing Google Drive folders with the Drive identities...\n');
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

    console.log('Getting Drive identities from Terraform...\n');
    const identities = getDriveIdentities(environment);

    // The CI account trashes E2E artifacts, which needs fileOrganizer; it keeps
    // its own grant rather than borrowing the organizer identity.
    const grantees: Grantee[] = [
      { email: identities.writer, role: 'writer' },
      { email: identities.organizer, role: 'fileOrganizer' },
      {
        email: `github-actions-terraform@${projectId}.iam.gserviceaccount.com`,
        role: 'fileOrganizer',
      },
    ];

    console.log('Granting:\n');
    grantees.forEach(({ email, role }) =>
      console.log(`  - ${email} (${role})`)
    );
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
    for (const grantee of grantees) {
      mainFolderResults.push(
        await shareFolderWithGrantee(drive, folderId, grantee)
      );
    }

    // Share category root folder if configured
    if (categoryRootFolderId) {
      console.log('\nSharing category root folder...\n');
      for (const grantee of grantees) {
        await shareFolderWithGrantee(drive, categoryRootFolderId, grantee);
      }
    }

    // Share uncategorized folder if configured
    if (uncategorizedFolderId) {
      console.log('\nSharing uncategorized folder...\n');
      for (const grantee of grantees) {
        await shareFolderWithGrantee(drive, uncategorizedFolderId, grantee);
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

    console.log('\n✅ Drive folder sharing complete.\n');
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
