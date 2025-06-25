import { Request, Response } from 'express';
import { CloudEvent } from '@google-cloud/functions-framework';
import { google } from 'googleapis';
import { PubSub } from '@google-cloud/pubsub';

interface CloudEventData {
  folderId?: string;
  topicName?: string;
}

interface DocumentFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
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
  'application/vnd.google-apps.presentation'
];

export const driveDocumentScanner = async (req: Request | CloudEvent<CloudEventData>, res?: Response) => {
  try {
    let folderId: string;
    let topicName: string;

    if (res) {
      // HTTP request
      const { folderId: reqFolderId, topicName: reqTopicName } = req.body || {};
      folderId = reqFolderId || (req.query as any)?.folderId;
      topicName = reqTopicName || (req.query as any)?.topicName;

      if (!folderId || !topicName) {
        res.status(400).json({
          error: 'Missing required parameters: folderId and topicName'
        });
        return;
      }
    } else {
      // CloudEvent request
      const cloudEvent = req as CloudEvent<CloudEventData>;
      folderId = cloudEvent.data?.folderId || '';
      topicName = cloudEvent.data?.topicName || '';

      if (!folderId || !topicName) {
        throw new Error('Missing required parameters: folderId and topicName');
      }
    }

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    const drive = google.drive({ version: 'v3', auth });

    // Initialize PubSub client
    const pubsub = new PubSub();
    const topic = pubsub.topic(topicName);

    // Search for document files in the specified folder
    const query = `'${folderId}' in parents and trashed=false and (${DOCUMENT_MIME_TYPES.map(type => `mimeType='${type}'`).join(' or ')})`;
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      pageSize: 100
    });

    const files = response.data.files || [];
    const documentFiles: DocumentFile[] = files.map(file => ({
      id: file.id!,
      name: file.name!,
      mimeType: file.mimeType!,
      size: file.size || undefined,
      modifiedTime: file.modifiedTime!,
      webViewLink: file.webViewLink!
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
        scanTimestamp: new Date().toISOString()
      };

      const dataBuffer = Buffer.from(JSON.stringify(messageData));
      return topic.publishMessage({
        data: dataBuffer,
        attributes: {
          fileId: doc.id,
          mimeType: doc.mimeType,
          operation: 'document-classification'
        }
      });
    });

    const messageIds = await Promise.all(publishPromises);

    const result = {
      message: `Successfully scanned folder ${folderId} and found ${documentFiles.length} document files`,
      filesFound: documentFiles.length,
      files: documentFiles,
      publishedMessages: messageIds.length,
      topicName: topicName
    };

    if (res) {
      res.status(200).json(result);
    } else {
      console.log(`Drive document scanner completed: ${JSON.stringify(result)}`);
      return result;
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Drive document scanner error:', error);

    if (res) {
      res.status(500).json({
        error: 'Drive document scanner failed',
        details: errorMessage
      });
    } else {
      throw new Error(`Drive document scanner failed: ${errorMessage}`);
    }
  }
};