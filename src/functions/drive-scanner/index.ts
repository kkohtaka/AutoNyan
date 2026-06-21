import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  isPermanentError,
  parsePubSubEvent,
  validateRequiredFields,
} from 'autonyan-shared';
import { createHash } from 'crypto';
import { drive_v3, google } from 'googleapis';

// Firestore collection used to record which (fileId, modifiedTime) pairs have
// already been published downstream. This makes scheduled scans idempotent:
// without it, every scan re-publishes every file, causing the per-file pipeline
// (Drive download, Vision API, Gemini classification) to run again and billing
// to grow linearly with file count on every schedule tick.
const SCANNED_FILES_COLLECTION = 'scanned_files';

// Build a deterministic, Firestore-safe document ID from the file identity.
// modifiedTime is included so that a genuinely updated file is reprocessed,
// while an unchanged file is skipped on subsequent scans.
const buildScannedFileId = (fileId: string, modifiedTime: string): string =>
  createHash('sha256').update(`${fileId}:${modifiedTime}`).digest('hex');

const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/rtf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];

interface DriveScanMessage extends Record<string, unknown> {
  folderId: string;
  metadata?: Record<string, unknown>;
}

interface Result {
  message: string;
  filesFound: number;
  files: drive_v3.Schema$File[];
  publishedMessages: number;
  skippedMessages: number;
  topicName: string | null;
  skipped?: boolean;
}

export const driveScanner = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  let parsedFolderId = '';

  try {
    // Log the incoming CloudEvent for debugging
    // eslint-disable-next-line no-console
    console.log('Received CloudEvent:', JSON.stringify(cloudEvent, null, 2));

    // Parse PubSub event data using shared utility
    const { data: messageData } =
      parsePubSubEvent<DriveScanMessage>(cloudEvent);

    // Validate required fields
    validateRequiredFields(messageData, ['folderId']);

    const { folderId } = messageData;
    parsedFolderId = folderId;

    // eslint-disable-next-line no-console
    console.log('Parsed message data:', JSON.stringify(messageData, null, 2));

    const topicName = process.env.DOC_PROCESS_TRIGGER_TOPIC;

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Fetch the folder metadata to ensure it exists
    const folderResponse = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });

    // eslint-disable-next-line no-console
    console.log(
      `Scanning folder: ${folderResponse.data.name} (${folderResponse.data.id})`
    );

    // Search for document files in the specified folder with pagination
    const query = `'${folderId}' in parents and trashed=false and (${DOCUMENT_MIME_TYPES.map(
      (type) => `mimeType='${type}'`
    ).join(' or ')})`;

    const allFiles: drive_v3.Schema$File[] = [];
    let nextPageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: query,
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
        pageToken: nextPageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = response.data.files || [];
      allFiles.push(...files);
      nextPageToken = response.data.nextPageToken || undefined;
    } while (nextPageToken);

    // Publish each document file to PubSub for document scan preparation (if topic is configured).
    // Files already recorded in the scanned_files collection (same fileId and
    // modifiedTime) are skipped to keep scheduled scans idempotent and avoid
    // re-running the billable downstream pipeline on every schedule tick.
    let publishedMessages = 0;
    let skippedMessages = 0;

    if (topicName) {
      const pubsub = new PubSub();
      const topic = pubsub.topic(topicName);

      const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
      const firestore = new Firestore({ databaseId });
      const scannedCollection = firestore.collection(SCANNED_FILES_COLLECTION);

      // Process files sequentially so the dedup check and record write stay
      // consistent and we never publish a file we have already recorded.
      for (const file of allFiles) {
        const modifiedTime = file.modifiedTime || '';
        const scannedFileId = buildScannedFileId(file.id || '', modifiedTime);
        const scannedDocRef = scannedCollection.doc(scannedFileId);

        const snapshot = await scannedDocRef.get();
        if (snapshot.exists) {
          skippedMessages++;
          // eslint-disable-next-line no-console
          console.log(
            `Skipping already-scanned file ${file.name} (${file.id}) modified at ${modifiedTime}`
          );
          continue;
        }

        const messageData = {
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
          size: file.size,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          folderId: folderId,
          scanTimestamp: new Date().toISOString(),
        };

        const dataBuffer = Buffer.from(JSON.stringify(messageData));
        await topic.publishMessage({
          data: dataBuffer,
          attributes: {
            fileId: file.id || '',
            mimeType: file.mimeType || '',
            operation: 'document-classification',
          },
        });

        // Record the file as scanned only after a successful publish so that a
        // publish failure leaves it eligible for retry on the next scan.
        await scannedDocRef.set({
          fileId: file.id || '',
          fileName: file.name || '',
          modifiedTime: modifiedTime,
          folderId: folderId,
          publishedAt: new Date().toISOString(),
        });

        publishedMessages++;
      }

      // eslint-disable-next-line no-console
      console.log(
        `Published ${publishedMessages} messages to topic ${topicName} (skipped ${skippedMessages} already-scanned files)`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        'DOC_PROCESS_TRIGGER_TOPIC environment variable not set, skipping PubSub publishing'
      );
    }

    const result = {
      message: `Successfully scanned folder ${folderId} and found ${allFiles.length} document files`,
      filesFound: allFiles.length,
      files: allFiles,
      publishedMessages: publishedMessages,
      skippedMessages: skippedMessages,
      topicName: topicName || null,
    };

    // Log completion for CloudEvent processing
    // eslint-disable-next-line no-console
    console.log(`Drive document scanner completed: ${JSON.stringify(result)}`);

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'driveScanner');

    // eslint-disable-next-line no-console
    console.error('Drive document scanner error:', errorResponse);

    // Permanent failures: ACK (do not retry) to avoid repeated billable calls.
    if (isPermanentError(error)) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping message (permanent failure, not retrying): ${errorResponse.error}`
      );

      const notificationTopicName = process.env.NOTIFICATION_TOPIC;
      if (notificationTopicName) {
        try {
          const pubsub = new PubSub();
          await pubsub.topic(notificationTopicName).publishMessage({
            json: {
              folderId: parsedFolderId,
              stageName: 'drive-scanner',
              errorMessage: errorResponse.error,
            },
            attributes: { operation: 'failure-notification' },
          });
        } catch (notifyError) {
          // eslint-disable-next-line no-console
          console.warn('Failed to publish failure notification:', notifyError);
        }
      }

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        filesFound: 0,
        files: [],
        publishedMessages: 0,
        skippedMessages: 0,
        topicName: process.env.DOC_PROCESS_TRIGGER_TOPIC || null,
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`Drive document scanner failed: ${errorResponse.error}`);
  }
};
