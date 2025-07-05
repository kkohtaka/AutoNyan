import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { google } from 'googleapis';
import { PubSub } from '@google-cloud/pubsub';

interface DocumentFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
}

interface DocumentScanResult {
  message: string;
  filesFound: number;
  files: DocumentFile[];
  publishedMessages: number;
  topicName: string;
}

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

export const folderScanner = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<DocumentScanResult> => {
  try {
    // CloudEvent from Pub/Sub
    const messageData = cloudEvent.data?.message?.data;
    const decoded = messageData
      ? JSON.parse(Buffer.from(messageData, 'base64').toString())
      : {};
    const folderId = decoded.folderId || '';
    const topicName = decoded.topicName || '';

    if (!folderId || !topicName) {
      throw new Error('Missing required parameters: folderId and topicName');
    }

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Initialize PubSub client
    const pubsub = new PubSub();
    const topic = pubsub.topic(topicName);

    // Search for document files in the specified folder
    const query = `'${folderId}' in parents and trashed=false and (${DOCUMENT_MIME_TYPES.map(
      (type) => `mimeType='${type}'`
    ).join(' or ')})`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      pageSize: 100,
    });

    const files = response.data.files || [];
    const documentFiles: DocumentFile[] = files.map((file) => ({
      id: file.id!,
      name: file.name!,
      mimeType: file.mimeType!,
      size: file.size || undefined,
      modifiedTime: file.modifiedTime!,
      webViewLink: file.webViewLink!,
    }));

    // Publish each document file to PubSub for classification
    const publishPromises = documentFiles.map(async (doc) => {
      const messageData = {
        fileId: doc.id,
        fileName: doc.name,
        mimeType: doc.mimeType,
        size: doc.size,
        modifiedTime: doc.modifiedTime,
        webViewLink: doc.webViewLink,
        folderId: folderId,
        scanTimestamp: new Date().toISOString(),
      };

      const dataBuffer = Buffer.from(JSON.stringify(messageData));
      return topic.publishMessage({
        data: dataBuffer,
        attributes: {
          fileId: doc.id,
          mimeType: doc.mimeType,
          operation: 'document-classification',
        },
      });
    });

    const messageIds = await Promise.all(publishPromises);

    const result = {
      message: `Successfully scanned folder ${folderId} and found ${documentFiles.length} document files`,
      filesFound: documentFiles.length,
      files: documentFiles,
      publishedMessages: messageIds.length,
      topicName: topicName,
    };

    // Log completion for CloudEvent processing
    // eslint-disable-next-line no-console
    console.log(
      `Drive document scanner completed: ${JSON.stringify(result)}`
    );
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    // eslint-disable-next-line no-console
    console.error('Drive document scanner error:', error);

    throw new Error(`Drive document scanner failed: ${errorMessage}`);
  }
};
