import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { drive_v3, google } from 'googleapis';

// Helper functions for Drive operations (for future use)
export const driveOperations = {
  // List files in a folder with full metadata
  async listFiles(
    drive: drive_v3.Drive,
    folderId: string,
    pageToken?: string
  ): Promise<drive_v3.Schema$FileList> {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
      pageSize: 100,
      pageToken: pageToken,
    });
    return response.data;
  },

  // Create a new folder
  async createFolder(
    drive: drive_v3.Drive,
    name: string,
    parentId: string
  ): Promise<drive_v3.Schema$File> {
    const response = await drive.files.create({
      requestBody: {
        name: name,
        parents: [parentId],
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id,name,parents',
    });
    return response.data;
  },

  // Move a file to a different folder
  async moveFile(
    drive: drive_v3.Drive,
    fileId: string,
    newParentId: string,
    currentParentId: string
  ): Promise<drive_v3.Schema$File> {
    const response = await drive.files.update({
      fileId: fileId,
      addParents: newParentId,
      removeParents: currentParentId,
      fields: 'id,name,parents',
    });
    return response.data;
  },

  // Copy a file to a different folder
  async copyFile(
    drive: drive_v3.Drive,
    fileId: string,
    newParentId: string,
    newName?: string
  ): Promise<drive_v3.Schema$File> {
    const response = await drive.files.copy({
      fileId: fileId,
      requestBody: {
        parents: [newParentId],
        name: newName,
      },
      fields: 'id,name,parents',
    });
    return response.data;
  },

  // Get folder metadata
  async getFolderInfo(
    drive: drive_v3.Drive,
    folderId: string
  ): Promise<drive_v3.Schema$File> {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,parents,createdTime,modifiedTime',
    });
    return response.data;
  },

  // Additional file operations (requires roles/drive.file)

  // List all files in Drive (not just in a folder)
  async listAllFiles(
    drive: drive_v3.Drive,
    pageToken?: string
  ): Promise<drive_v3.Schema$FileList> {
    const response = await drive.files.list({
      q: 'trashed=false',
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
      pageSize: 100,
      pageToken: pageToken,
    });
    return response.data;
  },

  // Search files by name or content
  async searchFiles(
    drive: drive_v3.Drive,
    query: string,
    pageToken?: string
  ): Promise<drive_v3.Schema$FileList> {
    const response = await drive.files.list({
      q: `name contains '${query}' and trashed=false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
      pageSize: 100,
      pageToken: pageToken,
    });
    return response.data;
  },

  // List contents of a specific folder with enhanced filtering
  async listFolderContents(
    drive: drive_v3.Drive,
    folderId: string,
    mimeTypeFilter?: string,
    pageToken?: string
  ): Promise<drive_v3.Schema$FileList> {
    let query = `'${folderId}' in parents and trashed=false`;
    if (mimeTypeFilter) {
      query += ` and mimeType='${mimeTypeFilter}'`;
    }

    const response = await drive.files.list({
      q: query,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
      pageSize: 100,
      pageToken: pageToken,
    });
    return response.data;
  },
};

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

interface FolderScanMessage {
  folderId: string;
  topicName: string;
  metadata?: Record<string, unknown>;
}

interface FolderScanResult {
  message: string;
  filesFound: number;
  files: drive_v3.Schema$File[];
  publishedMessages: number;
  topicName: string;
}

export const folderScanner = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<FolderScanResult> => {
  try {
    // CloudEvent from Cloud Scheduler contains base64 encoded data directly
    // Note: TypeScript types expect MessagePublishedData but Cloud Scheduler sends string data
    const eventData = cloudEvent.data as unknown as string;

    if (!eventData || typeof eventData !== 'string') {
      throw new Error('No message data found in CloudEvent');
    }

    const messageData: FolderScanMessage = JSON.parse(
      Buffer.from(eventData, 'base64').toString()
    );

    const { folderId, topicName } = messageData;

    if (!folderId || !topicName) {
      throw new Error('Missing required parameters: folderId and topicName');
    }

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
          fileId: file.id,
          mimeType: file.mimeType,
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
