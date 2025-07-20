import { CloudEvent } from '@google-cloud/functions-framework';
import { GetFileMetadataResponse, Storage } from '@google-cloud/storage';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { createHash } from 'crypto';
import { google } from 'googleapis';

interface Message {
  fileId: string;
  metadata?: Record<string, unknown>;
}

interface Result {
  message: string;
  fileId: string;
  fileName: string;
  bucketName: string;
  objectName: string;
  contentType: string;
  size: number;
}

export const docProcessor = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    // Parse the PubSub message data
    const pubsubMessage = cloudEvent.data?.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      throw new Error('No message data found in CloudEvent');
    }

    const messageData: Message = JSON.parse(
      Buffer.from(pubsubMessage.data, 'base64').toString()
    );

    const { fileId } = messageData;

    if (!fileId) {
      throw new Error('Missing required parameter: fileId');
    }

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Initialize Cloud Storage client
    const storage = new Storage();
    const bucketName = `${process.env.PROJECT_ID}-document-storage`;
    const bucket = storage.bucket(bucketName);

    // Get file metadata from Google Drive
    const fileResponse = await drive.files.get({
      fileId: fileId,
      fields: 'id,name,mimeType,size,modifiedTime',
    });

    const file = fileResponse.data;
    if (!file.id || !file.name) {
      throw new Error(`Invalid file data received for fileId: ${fileId}`);
    }

    // Download file content from Google Drive to calculate hash
    const fileContent = await drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
      },
      {
        responseType: 'stream',
      }
    );

    // Calculate hash of file content for object name
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      fileContent.data
        .on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          hash.update(chunk);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const fileBuffer = Buffer.concat(chunks);
    const contentHash = hash.digest('hex');

    // Generate object name based on content hash
    const objectName = `documents/${contentHash}`;

    // Check if object already exists in Cloud Storage
    const storageFile = bucket.file(objectName);
    const [exists] = await storageFile.exists();

    let metadata: GetFileMetadataResponse[0];
    if (exists) {
      // Object already exists, get its metadata
      [metadata] = await storageFile.getMetadata();
      // eslint-disable-next-line no-console
      console.log(
        `Object ${objectName} already exists in bucket, skipping upload`
      );
    } else {
      // Create a writable stream to Cloud Storage
      const stream = storageFile.createWriteStream({
        metadata: {
          contentType: file.mimeType || 'application/octet-stream',
          metadata: {
            originalFileId: file.id,
            originalFileName: file.name,
            originalMimeType: file.mimeType || 'unknown',
            originalSize: file.size || '0',
            originalModifiedTime: file.modifiedTime || new Date().toISOString(),
            scanTimestamp: new Date().toISOString(),
            contentHash: contentHash,
          },
        },
      });

      // Write the buffered content to Cloud Storage
      await new Promise<void>((resolve, reject) => {
        stream.write(fileBuffer, (error) => {
          if (error) {
            reject(error);
          } else {
            stream.end();
            resolve();
          }
        });
      });

      // Get the uploaded file metadata
      [metadata] = await storageFile.getMetadata();
      // eslint-disable-next-line no-console
      console.log(`Successfully uploaded new object ${objectName} to bucket`);
    }

    const result = {
      message: exists
        ? `File ${file.name} already exists in Cloud Storage, skipped upload`
        : `Successfully copied file ${file.name} from Google Drive to Cloud Storage`,
      fileId: file.id,
      fileName: file.name,
      bucketName: bucketName,
      objectName: objectName,
      contentType: file.mimeType || 'application/octet-stream',
      size: parseInt(String(metadata.size || '0'), 10),
    };

    // eslint-disable-next-line no-console
    console.log(
      `Document scan preparation completed: ${JSON.stringify(result)}`
    );

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    // eslint-disable-next-line no-console
    console.error('Document scan preparation error:', error);

    throw new Error(`Document scan preparation failed: ${errorMessage}`);
  }
};
