import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { createErrorResponse, getProjectId } from 'autonyan-shared';
import { listCategoryFolders, moveFileInDrive } from './drive-operations';
import { classifyWithGemini } from './classification';
import {
  parseDocumentData,
  updateDocumentWithClassification,
} from './firestore-operations';

interface FirestoreEvent {
  data: {
    value?: {
      fields?: Record<string, unknown>;
    };
  };
}

interface Result {
  message: string;
  category: string | null;
  confidence: number;
  fileId: string;
  fileName: string;
}

/**
 * Cloud Function triggered by Firestore document creation
 * Classifies documents using AI and moves them to appropriate folders in Google Drive
 */
export const fileClassifier = async (
  event: FirestoreEvent
): Promise<Result> => {
  try {
    // eslint-disable-next-line no-console
    console.log('Received Firestore event:', JSON.stringify(event, null, 2));

    // Get environment variables
    const projectId = getProjectId();
    const categoryRootFolderId = process.env.CATEGORY_ROOT_FOLDER_ID;
    const uncategorizedFolderId = process.env.UNCATEGORIZED_FOLDER_ID;

    if (!categoryRootFolderId || !uncategorizedFolderId) {
      throw new Error(
        'Missing required environment variables: CATEGORY_ROOT_FOLDER_ID or UNCATEGORIZED_FOLDER_ID'
      );
    }

    // Parse Firestore event data
    const documentSnapshot = convertFirestoreFields(
      event.data.value?.fields || {}
    );
    const documentData = parseDocumentData(documentSnapshot);

    // eslint-disable-next-line no-console
    console.log(
      `Processing classification for file: ${documentData.fileName} (${documentData.fileId})`
    );

    // Initialize Google Auth for Drive API
    const auth = new GoogleAuth({
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
      documentData.extractedText,
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
    await moveFileInDrive(auth, documentData.fileId, targetFolderId);

    // Update Firestore document with classification results
    const firestore = new Firestore();
    const documentPath = getDocumentPathFromEvent(event);

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
      message: `Successfully classified and moved file: ${documentData.fileName}`,
      category: classification.categoryName,
      confidence: classification.confidence,
      fileId: documentData.fileId,
      fileName: documentData.fileName,
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

/**
 * Convert Firestore field format to plain JavaScript object
 * Firestore events encode values in a specific format (e.g., {stringValue: "..."})
 */
function convertFirestoreFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'object' && value !== null) {
      const fieldValue = value as Record<string, unknown>;

      if ('stringValue' in fieldValue) {
        result[key] = fieldValue.stringValue;
      } else if ('integerValue' in fieldValue) {
        result[key] = parseInt(String(fieldValue.integerValue), 10);
      } else if ('doubleValue' in fieldValue) {
        result[key] = parseFloat(String(fieldValue.doubleValue));
      } else if ('arrayValue' in fieldValue) {
        const arrayValue = fieldValue.arrayValue as { values?: unknown[] };
        result[key] = arrayValue.values || [];
      } else if ('mapValue' in fieldValue) {
        const mapValue = fieldValue.mapValue as {
          fields?: Record<string, unknown>;
        };
        result[key] = convertFirestoreFields(mapValue.fields || {});
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract document path from Firestore event
 * Event format: projects/{project}/databases/{database}/documents/{collection}/{docId}
 */
function getDocumentPathFromEvent(event: FirestoreEvent): string {
  // In Firestore trigger events, the document path is available in event metadata
  // For now, we'll use a simple approach and construct it from the collection name
  // This should be adjusted based on actual event structure
  const eventData = event as unknown as {
    document?: string;
  };

  if (eventData.document) {
    // Extract the collection/docId part from the full path
    const match = eventData.document.match(/documents\/(.+)/);
    if (match) {
      return match[1];
    }
  }

  // Fallback: assume the collection is "extracted_texts"
  // This is a temporary solution and should be improved with proper event parsing
  throw new Error('Cannot determine document path from event');
}
