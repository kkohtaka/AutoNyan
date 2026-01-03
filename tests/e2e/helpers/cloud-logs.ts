import { execSync } from 'child_process';

/**
 * Get Cloud Function logs for debugging
 *
 * @param functionName - Function name
 * @param region - GCP region
 * @param since - Get logs since this date
 * @returns Logs as JSON string
 */
export async function getCloudFunctionLogs(
  functionName: string,
  region: string,
  since: Date
): Promise<string> {
  const sinceStr = since.toISOString();

  try {
    const logs = execSync(
      `gcloud functions logs read ${functionName} ` +
        `--region=${region} ` +
        `--limit=100 ` +
        `--filter="timestamp>='${sinceStr}'" ` +
        `--format=json`,
      { encoding: 'utf-8' }
    );

    return logs;
  } catch (error) {
    console.warn(`Failed to retrieve logs for ${functionName}:`, error);
    return '';
  }
}

/**
 * Debug pipeline failure by retrieving logs from all functions
 *
 * @param stage - Failed stage
 * @param context - Context information
 */
export async function debugPipelineFailure(
  stage: string,
  context: {
    fileId?: string;
    contentHash?: string;
    testStartTime: Date;
  }
): Promise<void> {
  console.log(`\n=== Debugging ${stage} failure ===`);

  const environment = process.env.ENVIRONMENT || 'staging';
  const region = process.env.GCP_REGION || 'us-central1';

  const functionNames = [
    `${environment}-drive-scanner`,
    `${environment}-doc-processor`,
    `${environment}-text-vision-processor`,
    `${environment}-text-firebase-writer`,
    `${environment}-file-classifier`,
  ];

  for (const funcName of functionNames) {
    console.log(`\nLogs for ${funcName}:`);
    const logs = await getCloudFunctionLogs(
      funcName,
      region,
      context.testStartTime
    );
    console.log(logs);
  }
}
