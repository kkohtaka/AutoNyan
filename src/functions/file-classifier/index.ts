import { Firestore } from '@google-cloud/firestore';
import { google } from 'googleapis';
import {
  createErrorResponse,
  getProjectId,
  parsePubSubEvent,
  validateRequiredFields,
} from 'autonyan-shared';
import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { listCategoryFolders, moveFileInDrive } from './drive-operations';
import { classifyWithGemini } from './classification';
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

    // Move file in Google Drive
    // eslint-disable-next-line no-console
    console.log(
      `Moving file to folder: ${targetFolderName} (${targetFolderId})`
    );
    await moveFileInDrive(auth, eventData.fileId, targetFolderId);

    // Update Firestore document with classification results
    const firestore = new Firestore();
    const documentPath = `extracted_texts/${eventData.firestoreDocId}`;

    // eslint-disable-next-line no-console
    console.log(`Updating Firestore document: ${documentPath}`);

    await updateDocumentWithClassification(firestore, documentPath, {
      category: classification.categoryName,
      categoryFolderId: targetFolderId,
      classificationConfidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      classifiedAt: new Date().toISOString(),
    });

    const result = {
      message: `Successfully classified and moved file: ${eventData.fileName}`,
      category: classification.categoryName,
      confidence: classification.confidence,
      fileId: eventData.fileId,
      fileName: eventData.fileName,
    };

    // eslint-disable-next-line no-console
    console.log(`Classification completed:`, result);

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'fileClassifier');

    // eslint-disable-next-line no-console
    console.error('File classification error:', errorResponse);

    throw new Error(`File classification failed: ${errorResponse.error}`);
  }
};
