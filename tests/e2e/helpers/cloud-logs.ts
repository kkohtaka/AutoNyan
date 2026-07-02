import { execSync } from 'child_process';

import { PollOptions } from './polling';

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
 * Poll a Cloud Function's logs until a single log entry contains all the
 * given substrings
 *
 * @param functionName - Function name
 * @param region - GCP region
 * @param since - Only consider logs since this date
 * @param substrings - Strings that must all appear in one log entry
 * @param options - Polling options
 * @returns The matching log entry text, or null on timeout when
 *          errorOnTimeout is false
 */
export async function pollForFunctionLogEntry(
  functionName: string,
  region: string,
  since: Date,
  substrings: string[],
  options: Partial<PollOptions> = {}
): Promise<string | null> {
  const opts: PollOptions = {
    timeout: 60000,
    interval: 10000,
    errorOnTimeout: true,
    ...options,
  };
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeout) {
    const logsJson = await getCloudFunctionLogs(functionName, region, since);

    if (logsJson) {
      let entries: { log?: string }[] = [];
      try {
        entries = JSON.parse(logsJson) as { log?: string }[];
      } catch {
        // Transient gcloud output issue; keep polling
      }

      const match = entries.find(
        (entry) =>
          typeof entry.log === 'string' &&
          substrings.every((s) => entry.log!.includes(s))
      );
      if (match) {
        return match.log!;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, opts.interval));
  }

  if (opts.errorOnTimeout) {
    throw new Error(
      `Timeout waiting for log entry containing [${substrings.join(', ')}] ` +
        `from ${functionName} after ${opts.timeout}ms`
    );
  }

  return null;
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
    `${environment}-notification-dispatcher`,
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
