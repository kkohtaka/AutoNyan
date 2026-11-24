import { Firestore, QueryDocumentSnapshot } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  EXTRACTED_TEXTS_COLLECTION,
  logger,
  ReorganizationEmailData,
  ReorganizationRecord,
  withEventContext,
} from 'autonyan-shared';

// How long a batch may wait for outcomes that have not arrived. The classifier
// retries a transient failure with backoff, so most stragglers land well
// inside this; a request whose message was dropped as a permanent failure
// never gets an outcome, and without a limit it would hold back the summary of
// every change that was applied alongside it.
const SETTLE_TIMEOUT_MS = 30 * 60 * 1000;

interface Result {
  message: string;
  // Batch-and-folder groups with unreported requests.
  groups: number;
  // Groups a summary was published for.
  notified: number;
  // Groups still waiting for outcomes.
  waiting: number;
}

interface PendingReport {
  record: ReorganizationRecord;
  fileId: string;
  snapshot: QueryDocumentSnapshot;
}

/**
 * Cloud Function triggered on a schedule that reports finished
 * re-organizations: one summary notification per folder per sweep batch,
 * listing the files that were renamed or moved.
 *
 * The classifier records each outcome on the document as it finishes, in no
 * particular order, so no invocation of it can tell that a batch is complete.
 * This stage can: it reports a batch once none of its requests is still
 * pending, and marks every request it has accounted for so the next run
 * passes over them.
 */
const reorganizationReporterHandler = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    logger.info('Received CloudEvent', { cloudEvent });

    const notificationTopicName = process.env.NOTIFICATION_TOPIC;
    if (!notificationTopicName) {
      throw new Error(
        'Missing required environment variable: NOTIFICATION_TOPIC'
      );
    }

    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({ databaseId });

    const snapshot = await firestore
      .collection(EXTRACTED_TEXTS_COLLECTION)
      .where('reorganization.reported', '==', false)
      .select('fileId', 'reorganization')
      .get();

    const groups = new Map<string, PendingReport[]>();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const record = data.reorganization as ReorganizationRecord;
      const key = JSON.stringify([record.batchId, record.folderId]);
      const group = groups.get(key) ?? [];
      group.push({ record, fileId: String(data.fileId || ''), snapshot: doc });
      groups.set(key, group);
    }

    const topic = new PubSub().topic(notificationTopicName);
    const now = Date.now();

    let notified = 0;
    let waiting = 0;

    for (const group of groups.values()) {
      const pending = group.filter(({ record }) => record.status === 'pending');
      const requestedAt = Math.min(
        ...group.map(({ record }) => Date.parse(record.requestedAt))
      );

      if (pending.length > 0 && now - requestedAt < SETTLE_TIMEOUT_MS) {
        waiting++;
        continue;
      }

      const { batchId, folderId, folderPath } = group[0].record;

      if (pending.length > 0) {
        logger.warn('Reporting a batch without its outstanding requests', {
          batchId,
          folderId,
          outstanding: pending.length,
        });
      }

      const changed = group.filter(({ record }) => record.status === 'changed');

      if (changed.length > 0) {
        const notification: ReorganizationEmailData = {
          folderId,
          folderPath,
          items: changed.map(({ record, fileId }) => ({
            fileId,
            previousFileName: record.previousFileName ?? '',
            fileName: record.newFileName ?? record.previousFileName ?? '',
            ...(record.newFolderPath
              ? { movedToPath: record.newFolderPath }
              : {}),
          })),
          failedCount: group.filter(({ record }) => record.status === 'failed')
            .length,
        };

        await topic.publishMessage({
          json: notification,
          attributes: {
            operation: 'reorganization-notification',
            folderId,
          },
        });
        notified++;
      }

      // One atomic write per group: marking only part of it would leave the
      // rest to be reported as a second summary for the same batch. A group
      // is bounded by the sweeper's per-sweep limit, far below what a single
      // batched write accepts.
      const marks = firestore.batch();
      for (const { snapshot: doc } of group) {
        marks.update(doc.ref, { 'reorganization.reported': true });
      }
      await marks.commit();

      logger.info('Reported re-organization batch', {
        batchId,
        folderId,
        requests: group.length,
        changed: changed.length,
      });
    }

    const result = {
      message: `Published ${notified} re-organization summaries for ${groups.size} batches, ${waiting} still waiting for outcomes`,
      groups: groups.size,
      notified,
      waiting,
    };

    logger.info('Re-organization report completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'reorganizationReporter');

    logger.error('Re-organization report error', { error: errorResponse });

    // The trigger carries no message body to be malformed, so no failure here
    // is permanent. Every failure is retried.
    throw new Error(`Re-organization report failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};

export const reorganizationReporter = withEventContext(
  reorganizationReporterHandler
);
