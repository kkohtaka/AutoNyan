import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
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

interface Message {
  folderId: string;
  metadata?: Record<string, unknown>;
}

interface Result {
  message: string;
  filesFound: number;
  files: drive_v3.Schema$File[];
  publishedMessages: number;
  topicName: string;
}

export const driveScanner = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    // CloudEvent from Cloud Scheduler contains plain text JSON data directly
    const eventData = cloudEvent.data as unknown as string;

    if (!eventData || typeof eventData !== 'string') {
      throw new Error('No message data found in CloudEvent');
    }

    const messageData: Message = JSON.parse(eventData);

    const { folderId } = messageData;

    if (!folderId) {
      throw new Error('Missing required parameter: folderId');
    }

    const topicName = 'doc-process-trigger';

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Fetch the folder metadata to ensure it exists
    const folderResponse = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType',
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
      });

      const files = response.data.files || [];
      allFiles.push(...files);
      nextPageToken = response.data.nextPageToken || undefined;
    } while (nextPageToken);

    // Publish each document file to PubSub for document scan preparation
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

    const result = {
      message: `Successfully scanned folder ${folderId} and found ${allFiles.length} document files`,
      filesFound: allFiles.length,
      files: allFiles,
      publishedMessages: messageIds.length,
      topicName: topicName,
    };

    // Log completion for CloudEvent processing
    // eslint-disable-next-line no-console
    console.log(`Drive document scanner completed: ${JSON.stringify(result)}`);

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    // eslint-disable-next-line no-console
    console.error('Drive document scanner error:', error);

    throw new Error(`Drive document scanner failed: ${errorMessage}`);
  }
};
