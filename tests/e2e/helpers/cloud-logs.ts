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
 * Poll a Cloud Function's logs until an entry matches all the given
 * jsonPayload fields
 *
 * Queries the Cloud Logging API via `gcloud logging read` rather than
 * `gcloud functions logs read`: the latter neither supports timestamp
 * filters (its resource keys are `time_utc`/`log`/...) nor exposes the
 * structured-logger context fields (e.g. `fileName`), both of which this
 * assertion needs.
 *
 * @param functionName - Function name (Gen2 Cloud Run service name)
 * @param region - GCP region
 * @param since - Only consider logs since this date
 * @param payloadMatch - jsonPayload fields the entry must match exactly
 * @param options - Polling options
 * @returns The matching entry's jsonPayload, or null on timeout when
 *          errorOnTimeout is false
 */
export async function pollForFunctionLogEntry(
  functionName: string,
  region: string,
  since: Date,
  payloadMatch: Record<string, string>,
  options: Partial<PollOptions> = {}
): Promise<Record<string, unknown> | null> {
  const opts: PollOptions = {
    timeout: 60000,
    interval: 10000,
    errorOnTimeout: true,
    ...options,
  };
  const startTime = Date.now();

  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${functionName}"`,
    `resource.labels.location="${region}"`,
    `timestamp>="${since.toISOString()}"`,
    ...Object.entries(payloadMatch).map(
      ([key, value]) => `jsonPayload.${key}="${value}"`
    ),
  ].join(' AND ');

  while (Date.now() - startTime < opts.timeout) {
    const entriesJson = execSync(
      `gcloud logging read '${filter}' --limit=1 --format=json`,
      { encoding: 'utf-8' }
    );
    const entries = JSON.parse(entriesJson) as {
      jsonPayload?: Record<string, unknown>;
    }[];

    if (entries.length > 0) {
      return entries[0].jsonPayload ?? {};
    }

    await new Promise((resolve) => setTimeout(resolve, opts.interval));
  }

  if (opts.errorOnTimeout) {
    throw new Error(
      `Timeout waiting for log entry matching ${JSON.stringify(payloadMatch)} ` +
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
