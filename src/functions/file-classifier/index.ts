import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  logger,
  parsePubSubEvent,
  validateRequiredFields,
} from 'autonyan-shared';
import { google } from 'googleapis';
import { classifyWithGemini } from './classification';
import {
  listCategoryFolders,
  listFileNamesInFolder,
  moveFileInDrive,
} from './drive-operations';
import { updateDocumentWithClassification } from './firestore-operations';
import { generateFileName, resolveRenamedFileName } from './rename';

interface ClassificationEventData extends Record<string, unknown> {
  firestoreDocId: string;
  fileId: string;
  fileName: string;
  extractedText: string;
  confidence: number;
}

interface Result {
  message: string;
  category: string | null;
  confidence: number;
  fileId: string;
  fileName: string;
  skipped?: boolean;
}

/**
 * Cloud Function triggered by PubSub message after Firestore document creation
 * Classifies documents using AI and moves them to appropriate folders in Google Drive
 */
export const fileClassifier = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    logger.info('Received PubSub event', { cloudEvent });

    // Parse PubSub event data
    const { data: eventData } =
      parsePubSubEvent<ClassificationEventData>(cloudEvent);

    // Validate required fields
    validateRequiredFields(eventData, [
      'firestoreDocId',
      'fileId',
      'fileName',
      'extractedText',
    ]);

    // Get environment variables
    const projectId = getProjectId();
    const categoryRootFolderId = process.env.CATEGORY_ROOT_FOLDER_ID;
    const uncategorizedFolderId = process.env.UNCATEGORIZED_FOLDER_ID;

    if (!categoryRootFolderId || !uncategorizedFolderId) {
      throw new Error(
        'Missing required environment variables: CATEGORY_ROOT_FOLDER_ID or UNCATEGORIZED_FOLDER_ID'
      );
    }

    logger.info('Processing classification for file', {
      fileName: eventData.fileName,
      fileId: eventData.fileId,
    });

    // Initialize Google Auth for Drive API
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    // Get category folders from Google Drive
    logger.info('Fetching category folders', { categoryRootFolderId });
    const categoryFolders = await listCategoryFolders(
      auth,
      categoryRootFolderId
    );

    if (categoryFolders.length === 0) {
      logger.warn('No category folders found in root folder', {
        categoryRootFolderId,
      });
    } else {
      logger.info('Found category folders', {
        count: categoryFolders.length,
        folderNames: categoryFolders.map((f) => f.name),
      });
    }

    logger.info('Classifying document with Gemini AI');
    const classification = await classifyWithGemini(
      projectId,
      eventData.extractedText,
      categoryFolders
    );

    logger.info('Classification result', { classification });

    // Determine target folder (category folder or uncategorized)
    const targetFolderId =
      classification.categoryFolderId || uncategorizedFolderId;
    const targetFolderName = classification.categoryName || 'Uncategorized';

    // Generate a content-derived file name, only when a category folder
    // matched (files routed to Uncategorized keep their original name).
    // Failures here are non-fatal: the file simply keeps its original name.
    let renamedFileName: string | null = null;
    let renameConfidence: number | null = null;
    let renameReasoning: string | null = null;

    if (classification.categoryFolderId) {
      try {
        const existingFileNames = await listFileNamesInFolder(
          auth,
          classification.categoryFolderId
        );

        logger.info('Generating file name with Gemini AI', {
          referenceFileCount: existingFileNames.length,
        });

        const generated = await generateFileName(
          projectId,
          eventData.extractedText,
          eventData.fileName,
          existingFileNames
        );

        renameConfidence = generated.confidence;
        renameReasoning = generated.reasoning;
        renamedFileName = resolveRenamedFileName(
          generated,
          eventData.fileName,
          existingFileNames
        );

        logger.info('File name generation result', {
          generated,
          renamedFileName,
        });
      } catch (renameError) {
        logger.warn('Failed to generate file name (keeping original name)', {
          error: renameError,
        });
      }
    }

    // Update Firestore document with classification results FIRST
    // This ensures E2E tests can verify classification even if file move fails
    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({
      databaseId,
    });
    const documentPath = `extracted_texts/${eventData.firestoreDocId}`;

    logger.info('Updating Firestore document', { documentPath });

    await updateDocumentWithClassification(firestore, documentPath, {
      category: classification.categoryName,
      categoryFolderId: targetFolderId,
      classificationConfidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      classifiedAt: new Date().toISOString(),
      summary: classification.summary,
      originalFileName: eventData.fileName,
      renamedFileName,
      renameConfidence,
      renameReasoning,
    });

    // Publish success notification (non-fatal)
    const notificationTopicName = process.env.NOTIFICATION_TOPIC;
    if (notificationTopicName) {
      try {
        const pubsub = new PubSub();
        const notificationData = {
          firestoreDocId: eventData.firestoreDocId,
          fileId: eventData.fileId,
          fileName: eventData.fileName,
          category: classification.categoryName,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          summary: classification.summary,
          destinationFolderId: targetFolderId,
        };
        await pubsub.topic(notificationTopicName).publishMessage({
          json: notificationData,
          attributes: {
            operation: 'success-notification',
            fileId: eventData.fileId,
          },
        });
      } catch (notifyError) {
        logger.warn('Failed to publish success notification', {
          error: notifyError,
        });
      }
    }

    // Move (and rename) file in Google Drive AFTER Firestore update
    // If move fails, classification is still considered successful (Firestore is already updated)
    let fileMoved = false;
    try {
      logger.info('Moving file to folder', {
        targetFolderName,
        targetFolderId,
        renamedFileName,
      });
      await moveFileInDrive(
        auth,
        eventData.fileId,
        targetFolderId,
        renamedFileName ?? undefined
      );
      fileMoved = true;
      logger.info('File moved successfully');
    } catch (moveError) {
      // Non-fatal: classification is already saved to Firestore.
      logger.warn('Failed to move file in Drive (classification still saved)', {
        error: moveError,
      });
    }

    const result = {
      message: fileMoved
        ? `Successfully classified and moved file: ${eventData.fileName}`
        : `Successfully classified file (file move failed): ${eventData.fileName}`,
      category: classification.categoryName,
      confidence: classification.confidence,
      fileId: eventData.fileId,
      fileName: eventData.fileName,
      fileMoved,
    };

    logger.info('Classification completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'fileClassifier');

    logger.error('File classification error', { error: errorResponse });

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
              fileId: '',
              fileName: '',
              stageName: 'file-classifier',
              errorMessage: errorResponse.error,
            },
            attributes: { operation: 'failure-notification' },
          });
        } catch (notifyError) {
          logger.warn('Failed to publish failure notification', {
            error: notifyError,
          });
        }
      }

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        category: null,
        confidence: 0,
        fileId: '',
        fileName: '',
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`File classification failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};
