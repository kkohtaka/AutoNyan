#!/usr/bin/env tsx

/**
 * Test Google Drive API access
 *
 * Validates that the authenticated user/service account can access
 * the configured Drive folder.
 */

import { google } from 'googleapis';
import * as path from 'path';
import * as fs from 'fs';

interface TerraformVariables {
  [key: string]: string;
}

/**
 * Get Terraform variables from per-environment tfvars file
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

async function testDriveAccess(): Promise<void> {
  console.log('Testing Google Drive API access...\n');

  try {
    // Get configuration from terraform.tfvars
    const tfvars = getTerraformVariables();
    const folderId = tfvars.drive_folder_id;
    const projectId = tfvars.project_id;

    if (!folderId) {
      throw new Error('drive_folder_id not found in tfvars');
    }

    console.log(`Project: ${projectId}`);
    console.log(`Drive Folder: ${folderId}\n`);

    // Initialize Drive API
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Try to get folder metadata
    console.log('Attempting to access folder...');
    const folderMetadata = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,permissions',
      supportsAllDrives: true,
    });

    console.log('✅ Successfully accessed folder');
    console.log(`   Folder name: ${folderMetadata.data.name}`);
    console.log(`   Folder ID: ${folderMetadata.data.id}\n`);

    // Try to list files in folder
    console.log('Attempting to list files in folder...');
    const fileList = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    console.log('✅ Successfully listed files');
    console.log(
      `   Found ${fileList.data.files?.length || 0} files in folder\n`
    );

    console.log('✅ Drive API access test passed');
    console.log('   You can now run E2E tests: npm run test:e2e\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any).code;

    console.error('❌ Drive API access test failed\n');
    console.error('Error:', errorMessage);

    if (
      errorMessage.includes('insufficient authentication scopes') ||
      errorCode === 403
    ) {
      console.error('\n⚠️  Authentication scope issue detected!\n');
      console.error(
        'The current Application Default Credentials do not include Drive API access.'
      );
      console.error(
        '\nTo fix this, re-authenticate with the correct scopes:\n'
      );
      console.error(
        '  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive\n'
      );
      console.error(
        'After re-authentication, run this test again: npm run test:e2e:check-drive\n'
      );
    } else if (errorMessage.includes('Unexpected Gaxios Error')) {
      console.error('\nThis may be caused by:');
      console.error('  1. Expired or missing credentials');
      console.error('  2. Network connectivity issues');
      console.error('  3. Service account not shared with the folder\n');
    } else if (errorCode === 404) {
      console.error('\nFolder not found. Verify:');
      console.error('  1. The folder ID in terraform.tfvars is correct');
      console.error('  2. The authenticated user has access to this folder\n');
    }

    process.exit(1);
  }
}

testDriveAccess();
