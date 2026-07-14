import { Firestore } from '@google-cloud/firestore';

export interface ClassificationUpdate {
  category: string | null;
  categoryFolderId: string | null;
  classificationConfidence: number;
  classificationReasoning: string;
  classifiedAt: string;
  summary: string;
  originalFileName: string;
  renamedFileName: string | null;
  renameConfidence: number | null;
  renameReasoning: string | null;
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
    summary: classification.summary,
    originalFileName: classification.originalFileName,
    renamedFileName: classification.renamedFileName,
    renameConfidence: classification.renameConfidence,
    renameReasoning: classification.renameReasoning,
  });
}
