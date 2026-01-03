import { GoogleAuth } from 'google-auth-library';

/**
 * Authenticate with Google Cloud Platform for E2E tests
 *
 * In local development: uses Application Default Credentials (ADC)
 * In CI/CD: uses Workload Identity Federation
 */
export async function authenticateE2E(): Promise<void> {
  const auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  try {
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();

    console.log(`Authenticated with project: ${projectId}`);

    // Set environment variables for GCP client libraries
    process.env.GOOGLE_CLOUD_PROJECT = projectId;
    if (!process.env.PROJECT_ID) {
      process.env.PROJECT_ID = projectId;
    }

    // Note: We don't test getAccessToken() here because it may fail
    // in some environments even though authentication is configured.
    // The actual API calls will validate credentials when they execute.
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error message for missing ADC
    if (
      errorMessage.includes('Could not load the default credentials') ||
      errorMessage.includes('Unexpected Gaxios Error')
    ) {
      throw new Error(
        `E2E authentication failed: Application Default Credentials (ADC) not configured.\n\n` +
          `To fix this, run one of the following:\n\n` +
          `  Local development:\n` +
          `    gcloud auth application-default login\n\n` +
          `  Service account (CI/CD):\n` +
          `    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json\n\n` +
          `Original error: ${errorMessage}`
      );
    }

    throw new Error(`E2E authentication failed: ${errorMessage}`);
  }
}
