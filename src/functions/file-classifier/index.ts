import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  parsePubSubEvent,
  validateRequiredFields,
} from 'autonyan-shared';
import { google } from 'googleapis';
import { classifyWithGemini } from './classification';
import { listCategoryFolders, moveFileInDrive } from './drive-operations';
import { updateDocumentWithClassification } from './firestore-operations';

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
    // eslint-disable-next-line no-console
    console.log('Received PubSub event:', JSON.stringify(cloudEvent, null, 2));

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

    // eslint-disable-next-line no-console
    console.log(
      `Processing classification for file: ${eventData.fileName} (${eventData.fileId})`
    );

    // Initialize Google Auth for Drive API
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    // Get category folders from Google Drive
    // eslint-disable-next-line no-console
    console.log(`Fetching category folders from: ${categoryRootFolderId}`);
    const categoryFolders = await listCategoryFolders(
      auth,
      categoryRootFolderId
    );

    if (categoryFolders.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `No category folders found in root folder: ${categoryRootFolderId}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `Found ${categoryFolders.length} category folders:`,
        categoryFolders.map((f) => f.name).join(', ')
      );
    }

    // Classify document using Gemini AI
    // eslint-disable-next-line no-console
    console.log('Classifying document with Gemini AI...');
    const classification = await classifyWithGemini(
      projectId,
      eventData.extractedText,
      categoryFolders
    );

    // eslint-disable-next-line no-console
    console.log('Classification result:', classification);

    // Determine target folder (category folder or uncategorized)
    const targetFolderId =
      classification.categoryFolderId || uncategorizedFolderId;
    const targetFolderName = classification.categoryName || 'Uncategorized';

    // Update Firestore document with classification results FIRST
    // This ensures E2E tests can verify classification even if file move fails
    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({
      databaseId,
    });
    const documentPath = `extracted_texts/${eventData.firestoreDocId}`;

    // eslint-disable-next-line no-console
    console.log(`Updating Firestore document: ${documentPath}`);

    await updateDocumentWithClassification(firestore, documentPath, {
      category: classification.categoryName,
      categoryFolderId: targetFolderId,
      classificationConfidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      classifiedAt: new Date().toISOString(),
      summary: classification.summary,
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
        // eslint-disable-next-line no-console
        console.warn('Failed to publish success notification:', notifyError);
      }
    }

    // Move file in Google Drive AFTER Firestore update
    // If move fails, classification is still considered successful (Firestore is already updated)
    let fileMoved = false;
    try {
      // eslint-disable-next-line no-console
      console.log(
        `Moving file to folder: ${targetFolderName} (${targetFolderId})`
      );
      await moveFileInDrive(auth, eventData.fileId, targetFolderId);
      fileMoved = true;
      // eslint-disable-next-line no-console
      console.log('File moved successfully');
    } catch (moveError) {
      // Log the error but don't fail the function - classification is already saved
      // eslint-disable-next-line no-console
      console.warn(
        'Failed to move file in Drive (classification still saved):',
        moveError
      );
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

    // eslint-disable-next-line no-console
    console.log(`Classification completed:`, result);

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'fileClassifier');

    // eslint-disable-next-line no-console
    console.error('File classification error:', errorResponse);

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
              fileId: '',
              fileName: '',
              stageName: 'file-classifier',
              errorMessage: errorResponse.error,
            },
            attributes: { operation: 'failure-notification' },
          });
        } catch (notifyError) {
          // eslint-disable-next-line no-console
          console.warn('Failed to publish failure notification:', notifyError);
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
    throw new Error(`File classification failed: ${errorResponse.error}`);
  }
};
