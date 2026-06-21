import { Storage } from '@google-cloud/storage';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { PubSub } from '@google-cloud/pubsub';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  parseStorageEvent,
  PermanentError,
} from 'autonyan-shared';

interface Result {
  message: string;
  objectName: string;
  outputBucket: string;
  outputPath: string;
  operationId: string;
  skipped?: boolean;
}

// Supported file types for text extraction (texts, PDFs, and images)
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/tiff',
];

export const textVisionProcessor = async (
  storageObjectData: StorageObjectData
): Promise<Result> => {
  let originalFileId = '';
  let originalFileName = '';

  try {
    // Log the incoming Storage object data for debugging
    // eslint-disable-next-line no-console
    console.log(
      'Received Storage object data:',
      JSON.stringify(storageObjectData, null, 2)
    );

    // Parse storage event data using shared utility
    const {
      bucket,
      name: objectName,
      contentType,
    } = parseStorageEvent(storageObjectData);

    // Check if file type is supported for text extraction
    if (!contentType || !SUPPORTED_MIME_TYPES.includes(contentType)) {
      // eslint-disable-next-line no-console
      console.log(
        `Skipping text extraction for unsupported file type: ${contentType}`
      );
      throw new PermanentError(
        `Unsupported file type for text extraction: ${contentType}`
      );
    }

    // Initialize clients
    const storage = new Storage();
    const vision = new ImageAnnotatorClient();

    // Get the file metadata to extract contentHash
    const file = storage.bucket(bucket).file(objectName);
    const [metadata] = await file.getMetadata();

    originalFileId = String(metadata.metadata?.originalFileId || '');
    originalFileName = String(metadata.metadata?.originalFileName || '');
    const contentHash = metadata.metadata?.contentHash;

    if (!originalFileId || !originalFileName || !contentHash) {
      throw new PermanentError('Missing required metadata from uploaded file');
    }

    // eslint-disable-next-line no-console
    console.log(
      `Starting Vision API processing for ${originalFileName} (${objectName})`
    );

    // Setup output bucket and path
    const projectId = getProjectId();
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error(
        'ENVIRONMENT environment variable is required but not set'
      );
    }

    const outputBucket = `${projectId}-${environment}-vision-results`;
    const outputPath = `results/${contentHash}/`;

    // Handle text files separately - no need for Vision API
    if (contentType === 'text/plain') {
      // For plain text files, read content and create a simple result structure
      const [fileContent] = await file.download();
      const extractedText = fileContent.toString('utf-8');

      const textResult = {
        responses: [
          {
            fullTextAnnotation: {
              text: extractedText,
              pages: [
                {
                  confidence: 1.0,
                },
              ],
            },
          },
        ],
      };

      // Store the result in the output bucket
      const outputFile = storage
        .bucket(outputBucket)
        .file(`${outputPath}output-1-to-1.json`);
      await outputFile.save(JSON.stringify(textResult, null, 2), {
        metadata: {
          contentType: 'application/json',
          metadata: {
            originalFileId: originalFileId,
            originalFileName: originalFileName,
            originalMimeType: contentType,
            contentHash: contentHash,
            processedAt: new Date().toISOString(),
          },
        },
      });

      return {
        message: `Successfully processed text file ${originalFileName}`,
        objectName: objectName,
        outputBucket: outputBucket,
        outputPath: outputPath,
        operationId: 'text-direct-processing',
      };
    }

    // For PDFs and images, use Vision API async batch processing
    const request = {
      requests: [
        {
          inputConfig: {
            gcsSource: {
              uri: `gs://${bucket}/${objectName}`,
            },
            mimeType: contentType,
          },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' as const }],
          outputConfig: {
            gcsDestination: {
              uri: `gs://${outputBucket}/${outputPath}`,
            },
            batchSize: 20,
          },
        },
      ],
    };

    // Call Vision API async batch processing
    const [operation] = await vision.asyncBatchAnnotateFiles(request);

    // eslint-disable-next-line no-console
    console.log(`Vision API operation started: ${operation.name}`);

    // Wait for the operation to complete
    const [result] = await operation.promise();

    if (!result.responses || result.responses.length === 0) {
      throw new Error('No responses received from Vision API');
    }

    const result_obj = {
      message: `Successfully processed ${originalFileName} with Vision API`,
      objectName: objectName,
      outputBucket: outputBucket,
      outputPath: outputPath,
      operationId: operation.name || 'unknown',
    };

    // eslint-disable-next-line no-console
    console.log(
      `Vision API processing completed: ${JSON.stringify(result_obj)}`
    );

    return result_obj;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'textVisionProcessor');

    // eslint-disable-next-line no-console
    console.error('Vision API processing error:', errorResponse);

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
              fileId: originalFileId,
              fileName: originalFileName,
              stageName: 'text-vision-processor',
              errorMessage: errorResponse.error,
            },
            attributes: {
              operation: 'failure-notification',
              fileId: originalFileId,
            },
          });
        } catch (notifyError) {
          // eslint-disable-next-line no-console
          console.warn('Failed to publish failure notification:', notifyError);
        }
      }

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        objectName: '',
        outputBucket: '',
        outputPath: '',
        operationId: 'skipped',
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`Vision API processing failed: ${errorResponse.error}`);
  }
};
