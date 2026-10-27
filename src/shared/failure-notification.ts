import type { PubSub } from '@google-cloud/pubsub';
import { currentEventId, logger } from './logger';

export interface FailureNotificationDetails {
  stageName: string;
  errorMessage: string;
  fileId?: string;
  fileName?: string;
  folderId?: string;
}

/**
 * Publish a failure notification for the event being processed
 *
 * A notification is best effort: the failure it reports has already been
 * handled, so a publish error is logged and swallowed rather than turning an
 * ACKed permanent failure into a retried one. The Pub/Sub client is the
 * caller's because the shared code is copied into every function at build
 * time, including ones that do not depend on the Pub/Sub library.
 * @param pubsub Pub/Sub client of the calling function
 * @param details What failed, and the file or folder it concerns
 */
export async function publishFailureNotification(
  pubsub: PubSub,
  details: FailureNotificationDetails
): Promise<void> {
  const notificationTopicName = process.env.NOTIFICATION_TOPIC;
  if (!notificationTopicName) {
    return;
  }

  const eventId = currentEventId();

  try {
    await pubsub.topic(notificationTopicName).publishMessage({
      json: {
        ...details,
        ...(eventId ? { eventId } : {}),
      },
      attributes: {
        operation: 'failure-notification',
        ...(details.fileId !== undefined ? { fileId: details.fileId } : {}),
      },
    });
  } catch (notifyError) {
    logger.warn('Failed to publish failure notification', {
      error: notifyError,
    });
  }
}
