import { Firestore } from '@google-cloud/firestore';

export interface DocumentData {
  fileId: string;
  fileName: string;
  extractedText: string;
  [key: string]: unknown;
}

export interface ClassificationUpdate {
  category: string | null;
  categoryFolderId: string | null;
  classificationConfidence: number;
  classificationReasoning: string;
  classifiedAt: string;
}

/**
 * Parse Firestore document data from event
 * @param documentSnapshot Firestore document snapshot data
 * @returns Parsed document data
 */
export function parseDocumentData(
  documentSnapshot: Record<string, unknown>
): DocumentData {
  const fileId = documentSnapshot.fileId as string;
  const fileName = documentSnapshot.fileName as string;
  const extractedText = documentSnapshot.extractedText as string;

  if (!fileId || !fileName || !extractedText) {
    throw new Error('Missing required fields in Firestore document');
  }

  return {
    fileId,
    fileName,
    extractedText,
    ...documentSnapshot,
  };
}

/**
 * Update Firestore document with classification results
 * @param firestore Firestore instance
 * @param documentPath Full path to the document (e.g., "extracted_texts/doc123")
 * @param classification Classification data to store
 */
export async function updateDocumentWithClassification(
  firestore: Firestore,
  documentPath: string,
  classification: ClassificationUpdate
): Promise<void> {
  const docRef = firestore.doc(documentPath);

  await docRef.update({
    category: classification.category,
    categoryFolderId: classification.categoryFolderId,
    classificationConfidence: classification.classificationConfidence,
    classificationReasoning: classification.classificationReasoning,
    classifiedAt: classification.classifiedAt,
  });
}
