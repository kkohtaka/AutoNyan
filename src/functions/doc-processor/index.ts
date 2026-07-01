import { CloudEvent } from '@google-cloud/functions-framework';
import { GetFileMetadataResponse, Storage } from '@google-cloud/storage';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  logger,
  parsePubSubEvent,
  PermanentError,
  validateRequiredFields,
} from 'autonyan-shared';
import { createHash } from 'crypto';
import { google } from 'googleapis';

interface DocProcessMessage extends Record<string, unknown> {
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
  skipped?: boolean;
}

export const docProcessor = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  let parsedFileId = '';

  try {
    logger.info('Received CloudEvent', { cloudEvent });

    // Parse PubSub event data using shared utility
    const { data: messageData } =
      parsePubSubEvent<DocProcessMessage>(cloudEvent);

    // Validate required fields
    validateRequiredFields(messageData, ['fileId']);

    const { fileId } = messageData;
    parsedFileId = fileId;

    logger.info('Parsed message data', { messageData });

    // Initialize Google Drive API with default credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Initialize Cloud Storage client
    const storage = new Storage();
    const projectId = getProjectId();
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error(
        'ENVIRONMENT environment variable is required but not set'
      );
    }
    const bucketName = `${projectId}-${environment}-document-storage`;
    const bucket = storage.bucket(bucketName);

    // Get file metadata from Google Drive
    const fileResponse = await drive.files.get({
      fileId: fileId,
      fields: 'id,name,mimeType,size,modifiedTime',
      supportsAllDrives: true,
    });

    const file = fileResponse.data;
    if (!file.id || !file.name) {
      throw new PermanentError(
        `Invalid file data received for fileId: ${fileId}`
      );
    }

    // Download file content from Google Drive to calculate hash
    const fileContent = await drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
        supportsAllDrives: true,
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
      logger.info('Object already exists in bucket, skipping upload', {
        objectName,
      });
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
      logger.info('Successfully uploaded new object to bucket', { objectName });
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

    logger.info('Document scan preparation completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'docProcessor');

    logger.error('Document scan preparation error', { error: errorResponse });

    // Permanent failures: ACK (do not retry) to avoid repeated billable calls.
    if (isPermanentError(error)) {
      logger.warn('Skipping message (permanent failure, not retrying)', {
        error: errorResponse.error,
      });

      const notificationTopicName = process.env.NOTIFICATION_TOPIC;
      if (notificationTopicName) {
        try {
          const pubsub = new PubSub();
          await pubsub.topic(notificationTopicName).publishMessage({
            json: {
              fileId: parsedFileId,
              fileName: '',
              stageName: 'doc-processor',
              errorMessage: errorResponse.error,
            },
            attributes: {
              operation: 'failure-notification',
              fileId: parsedFileId,
            },
          });
        } catch (notifyError) {
          logger.warn('Failed to publish failure notification', {
            error: notifyError,
          });
        }
      }

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        fileId: '',
        fileName: '',
        bucketName: '',
        objectName: '',
        contentType: '',
        size: 0,
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(
      `Document scan preparation failed: ${errorResponse.error}`,
      {
        cause: error,
      }
    );
  }
};
