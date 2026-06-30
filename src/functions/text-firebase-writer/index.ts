import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  logger,
  parseStorageEvent,
  PermanentError,
} from 'autonyan-shared';

interface PageText {
  pageNumber: number;
  text: string;
  confidence: number;
}

interface ExtractedText {
  fileId: string;
  objectName: string;
  extractedText: string;
  confidence: number;
  pages: PageText[];
  extractedAt: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  contentHash: string;
  visionResultPath: string;
}

interface Result {
  message: string;
  firestoreDocId: string;
  textLength: number;
  confidence: number;
  pages: number;
  originalFileName: string;
  classificationTriggered: boolean;
  skipped?: boolean;
}

interface VisionApiResponse {
  fullTextAnnotation?: {
    text?: string;
    pages?: Array<{
      confidence?: number;
    }>;
  };
}

interface VisionApiResult {
  responses?: VisionApiResponse[];
}

export const textFirebaseWriter = async (
  storageObjectData: StorageObjectData
): Promise<Result> => {
  let originalFileId = '';
  let originalFileName = '';

  try {
    logger.info('Received Storage object data', { storageObjectData });

    // Parse storage event data using shared utility
    const {
      bucket,
      name: objectName,
      contentType,
    } = parseStorageEvent(storageObjectData);

    // Only process JSON files from Vision API
    if (
      contentType !== 'application/octet-stream' &&
      contentType !== 'application/json'
    ) {
      logger.info('Skipping non-JSON file', { objectName });
      throw new PermanentError(`Unsupported file type: ${contentType}`);
    }

    // Initialize clients
    const storage = new Storage();
    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({
      databaseId,
    });

    // Get the Vision API result file
    const file = storage.bucket(bucket).file(objectName);
    const [metadata] = await file.getMetadata();

    // Extract metadata
    originalFileId = String(metadata.metadata?.originalFileId || '');
    originalFileName = String(metadata.metadata?.originalFileName || '');
    const originalMimeType = String(metadata.metadata?.originalMimeType || '');
    const contentHash = String(metadata.metadata?.contentHash || '');
    const processedAt = String(metadata.metadata?.processedAt || '');

    if (!originalFileId || !originalFileName || !contentHash) {
      throw new PermanentError(
        'Missing required metadata from Vision API result file'
      );
    }

    logger.info('Processing Vision API results', {
      originalFileName,
      objectName,
    });

    // Download and parse the Vision API result JSON
    const [fileContent] = await file.download();
    const visionResult: VisionApiResult = JSON.parse(
      fileContent.toString('utf-8')
    );

    if (!visionResult.responses || visionResult.responses.length === 0) {
      throw new PermanentError('No responses found in Vision API result');
    }

    // Aggregate text from all pages
    let extractedText = '';
    let totalConfidence = 0;
    let pageCount = 0;
    const pages: PageText[] = [];

    for (const response of visionResult.responses) {
      if (response.fullTextAnnotation) {
        const pageText = response.fullTextAnnotation.text || '';
        const confidence =
          response.fullTextAnnotation.pages?.[0]?.confidence || 0;

        if (pageText.trim()) {
          extractedText += pageText;
          if (pageCount > 0) {
            extractedText += '\n'; // Add newline between pages
          }

          totalConfidence += confidence;
          pageCount++;

          pages.push({
            pageNumber: pageCount,
            text: pageText,
            confidence: confidence,
          });
        }
      }
    }

    const overallConfidence = pageCount > 0 ? totalConfidence / pageCount : 0;

    // Get file size from the original document storage
    const projectId = getProjectId();
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error(
        'ENVIRONMENT environment variable is required but not set'
      );
    }

    const documentBucket = `${projectId}-${environment}-document-storage`;
    const originalObjectName = `documents/${contentHash}`;

    let fileSize = 0;
    try {
      const originalFile = storage
        .bucket(documentBucket)
        .file(originalObjectName);
      const [originalMetadata] = await originalFile.getMetadata();
      fileSize = parseInt(String(originalMetadata.size || '0'), 10);
    } catch (error) {
      logger.warn('Could not get original file size', { error });
    }

    // Prepare data for Firestore
    const extractedTextDoc: ExtractedText = {
      fileId: originalFileId,
      objectName: originalObjectName,
      extractedText: extractedText,
      confidence: overallConfidence,
      pages: pages,
      extractedAt: processedAt || new Date().toISOString(),
      mimeType: originalMimeType || 'unknown',
      fileName: originalFileName,
      fileSize: fileSize,
      contentHash: contentHash,
      visionResultPath: `gs://${bucket}/${objectName}`,
    };

    // Store extracted text in Firestore
    const collection = firestore.collection('extracted_texts');
    const docRef = await collection.add(extractedTextDoc);

    // Trigger file classification via PubSub (if topic is configured)
    const classifierTopicName = process.env.FILE_CLASSIFIER_TOPIC;
    let classificationTriggered = false;

    if (classifierTopicName) {
      const pubsub = new PubSub();

      try {
        const classificationData = {
          firestoreDocId: docRef.id,
          fileId: originalFileId,
          fileName: originalFileName,
          extractedText: extractedText,
          confidence: overallConfidence,
        };

        const topic = pubsub.topic(classifierTopicName);
        await topic.publishMessage({
          json: classificationData,
          attributes: {
            operation: 'file-classification',
            fileId: originalFileId,
            mimeType: originalMimeType || 'unknown',
          },
        });

        classificationTriggered = true;

        logger.info('Published classification trigger', {
          originalFileName,
          topicName: classifierTopicName,
        });
      } catch (pubsubError) {
        // PubSub failure here is non-fatal: the text is already in Firestore.
        logger.warn('Failed to publish classification trigger', {
          error: pubsubError,
        });
      }
    } else {
      logger.info(
        'FILE_CLASSIFIER_TOPIC not set, skipping classification trigger'
      );
    }

    const result = {
      message: `Successfully stored extracted text from ${originalFileName}`,
      firestoreDocId: docRef.id,
      textLength: extractedText.length,
      confidence: overallConfidence,
      pages: pages.length,
      originalFileName: originalFileName,
      classificationTriggered: classificationTriggered,
    };

    logger.info('Firebase storage completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'textFirebaseWriter');

    logger.error('Firebase storage error', { error: errorResponse });

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
              fileId: originalFileId,
              fileName: originalFileName,
              stageName: 'text-firebase-writer',
              errorMessage: errorResponse.error,
            },
            attributes: {
              operation: 'failure-notification',
              fileId: originalFileId,
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
        firestoreDocId: '',
        textLength: 0,
        confidence: 0,
        pages: 0,
        originalFileName: '',
        classificationTriggered: false,
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`Firebase storage failed: ${errorResponse.error}`);
  }
};
