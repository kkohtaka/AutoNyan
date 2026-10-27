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
  publishFailureNotification,
  withEventContext,
} from 'autonyan-shared';

// Firestore caps a document at 1 MiB and the classification prompt reads only
// a document's opening, so a long document is stored and passed on by its
// first pages. The complete text stays in the result object at
// visionResultPath.
const MAX_STORED_PAGES = 20;

// gRPC status for a create() on a document that already exists.
const FIRESTORE_ALREADY_EXISTS = 6;

interface PageConfidence {
  pageNumber: number;
  confidence: number;
}

interface ExtractedText {
  fileId: string;
  objectName: string;
  extractedText: string;
  confidence: number;
  pages: PageConfidence[];
  // Pages with text in the Vision result, and how many of them extractedText
  // holds; the classifier tells the model when the two differ.
  totalPages: number;
  includedPages: number;
  extractedAt: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  contentHash: string;
  visionResultPath: string;
  // Drive's modifiedTime at ingestion, the reference date for calendar
  // registration when the document is re-processed later.
  modifiedTime?: string;
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
  duplicate?: boolean;
}

interface VisionApiResponse {
  fullTextAnnotation?: {
    text?: string;
    pages?: Array<{
      confidence?: number;
    }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

interface VisionApiResult {
  responses?: VisionApiResponse[];
}

const textFirebaseWriterHandler = async (
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

    // Vision's per-batch shards land under raw/ until text-vision-processor
    // merges them under results/; a shard is not a document to store.
    if (objectName.startsWith('raw/')) {
      logger.info('Ignoring raw Vision API output shard', { objectName });

      return {
        message: `Ignored raw Vision API output shard: ${objectName}`,
        firestoreDocId: '',
        textLength: 0,
        confidence: 0,
        pages: 0,
        originalFileName: '',
        classificationTriggered: false,
        skipped: true,
      };
    }

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

    // Vision API writes result objects without custom metadata, so the
    // original document object (keyed by the contentHash in the result path)
    // is the only reliable metadata source.
    const hashMatch = objectName.match(/^results\/([^/]+)\//);
    if (!hashMatch) {
      throw new PermanentError(
        `Unexpected Vision API result object path: ${objectName}`
      );
    }
    const contentHash = hashMatch[1];

    const projectId = getProjectId();
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error(
        'ENVIRONMENT environment variable is required but not set'
      );
    }

    const documentBucket = `${projectId}-${environment}-document-storage`;
    const originalObjectName = `documents/${contentHash}`;

    const [originalMetadata] = await storage
      .bucket(documentBucket)
      .file(originalObjectName)
      .getMetadata();

    originalFileId = String(originalMetadata.metadata?.originalFileId || '');
    originalFileName = String(
      originalMetadata.metadata?.originalFileName || ''
    );
    const originalMimeType = String(
      originalMetadata.metadata?.originalMimeType || ''
    );
    const originalModifiedTime = String(
      originalMetadata.metadata?.originalModifiedTime || ''
    );

    if (!originalFileId || !originalFileName) {
      throw new PermanentError(
        'Missing required metadata on original document object'
      );
    }

    const fileSize = parseInt(String(originalMetadata.size || '0'), 10);

    logger.info('Processing Vision API results', {
      originalFileName,
      objectName,
    });

    // Download and parse the Vision API result JSON
    const file = storage.bucket(bucket).file(objectName);
    const [fileContent] = await file.download();
    const visionResult: VisionApiResult = JSON.parse(
      fileContent.toString('utf-8')
    );

    if (!visionResult.responses || visionResult.responses.length === 0) {
      throw new PermanentError('No responses found in Vision API result');
    }

    const pageTexts: string[] = [];
    const pages: PageConfidence[] = [];
    let totalConfidence = 0;

    for (const response of visionResult.responses) {
      const annotation = response.fullTextAnnotation;
      if (!annotation) {
        continue;
      }

      const pageText = annotation.text || '';
      if (!pageText.trim()) {
        continue;
      }

      const confidence = annotation.pages?.[0]?.confidence || 0;
      totalConfidence += confidence;
      pageTexts.push(pageText);
      pages.push({ pageNumber: pages.length + 1, confidence });
    }

    const totalPages = pages.length;

    // Vision embeds per-file extraction failures in the result JSON instead
    // of failing the operation, so a result with no usable text is an
    // extraction failure to surface, not a blank document to store.
    const embeddedErrors = visionResult.responses
      .filter((response) => response.error)
      .map((response) => response.error?.message || 'unknown error');

    if (totalPages === 0) {
      throw new PermanentError(
        embeddedErrors.length > 0
          ? `Vision API result contains only errors: ${embeddedErrors.join('; ')}`
          : 'Vision API result contains no extracted text'
      );
    }

    if (embeddedErrors.length > 0) {
      logger.warn('Vision API result contains page-level errors', {
        originalFileName,
        errors: embeddedErrors,
      });
    }

    const overallConfidence = totalConfidence / totalPages;
    const includedPages = Math.min(totalPages, MAX_STORED_PAGES);
    const extractedText = pageTexts.slice(0, includedPages).join('\n');

    // Prepare data for Firestore
    const extractedTextDoc: ExtractedText = {
      fileId: originalFileId,
      objectName: originalObjectName,
      extractedText: extractedText,
      confidence: overallConfidence,
      pages: pages,
      totalPages,
      includedPages,
      extractedAt: new Date().toISOString(),
      mimeType: originalMimeType || 'unknown',
      fileName: originalFileName,
      fileSize: fileSize,
      contentHash: contentHash,
      visionResultPath: `gs://${bucket}/${objectName}`,
      ...(originalModifiedTime ? { modifiedTime: originalModifiedTime } : {}),
    };

    // Keyed by content hash so that a second finalize event for the same
    // result object cannot store the document, or classify it, twice.
    const docRef = firestore.collection('extracted_texts').doc(contentHash);

    try {
      await docRef.create(extractedTextDoc);
    } catch (createError) {
      if (
        (createError as { code?: number }).code !== FIRESTORE_ALREADY_EXISTS
      ) {
        throw createError;
      }

      logger.info('Extracted text already stored, skipping duplicate event', {
        originalFileName,
        contentHash,
      });

      return {
        message: `Extracted text already stored for ${originalFileName}`,
        firestoreDocId: docRef.id,
        textLength: extractedText.length,
        confidence: overallConfidence,
        pages: totalPages,
        originalFileName: originalFileName,
        classificationTriggered: false,
        duplicate: true,
      };
    }

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
          totalPages,
          includedPages,
          // Carried through to calendar registration, where it is the
          // reference date for resolving year-less dates.
          modifiedTime: originalModifiedTime,
          // Carried through to calendar registration, which reads the source
          // file for the layout the extracted text loses.
          objectName: originalObjectName,
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
      pages: totalPages,
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

      await publishFailureNotification(new PubSub(), {
        stageName: 'text-firebase-writer',
        errorMessage: errorResponse.error,
        fileId: originalFileId,
        fileName: originalFileName,
      });

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
    throw new Error(`Firebase storage failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};

export const textFirebaseWriter = withEventContext(textFirebaseWriterHandler);
