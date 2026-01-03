#!/usr/bin/env tsx

/**
 * Pre-flight check for E2E test authentication
 *
 * Validates that Google Cloud authentication is properly configured
 * before running E2E tests.
 */

import { GoogleAuth } from 'google-auth-library';

async function checkAuthentication(): Promise<boolean> {
  console.log('Checking Google Cloud authentication...\n');

  const auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  try {
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();

    // Test credentials by getting an access token
    const credentials = await client.getAccessToken();

    if (!credentials.token) {
      throw new Error('Failed to obtain access token');
    }

    console.log('✅ Authentication successful');
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Auth type: ${client.constructor.name}\n`);

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('❌ Authentication failed\n');
    console.error('Error:', errorMessage);
    console.error('\nTo fix this, run:\n');
    console.error('  Local development:');
    console.error('    gcloud auth application-default login\n');
    console.error('  Service account (CI/CD):');
    console.error(
      '    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json\n'
    );

    process.exit(1);
  }
}

checkAuthentication();
