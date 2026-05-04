import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  ParameterParsingError,
  parsePubSubEvent,
  validateRequiredFields,
  ValidationError,
} from 'autonyan-shared';
import { drive_v3, google } from 'googleapis';

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
  topicName: string | null;
}

export const driveScanner = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
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

    // Publish each document file to PubSub for document scan preparation (if topic is configured)
    let publishedMessages = 0;

    if (topicName) {
      const pubsub = new PubSub();
      const topic = pubsub.topic(topicName);

      const publishPromises = allFiles.map(async (file) => {
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
        return topic.publishMessage({
          data: dataBuffer,
          attributes: {
            fileId: file.id || '',
            mimeType: file.mimeType || '',
            operation: 'document-classification',
          },
        });
      });

      const messageIds = await Promise.all(publishPromises);
      publishedMessages = messageIds.length;

      // eslint-disable-next-line no-console
      console.log(
        `Published ${publishedMessages} messages to topic ${topicName}`
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

    // Re-throw with proper error type
    if (
      error instanceof ParameterParsingError ||
      error instanceof ValidationError
    ) {
      throw error;
    }

    throw new Error(`Drive document scanner failed: ${errorResponse.error}`);
  }
};
