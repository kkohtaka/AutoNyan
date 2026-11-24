import { FieldValue, Firestore } from '@google-cloud/firestore';
import { ReorganizationStatus } from 'autonyan-shared';

export interface ClassificationUpdate {
  // Top-level category name. It stays the top-level name for a document
  // filed into a subfolder, because calendars are mapped by it.
  category: string | null;
  // Folder names from the top-level category down to the destination.
  categoryPath: string[] | null;
  categoryFolderId: string | null;
  // Fingerprint of the category folders that existed for this run. The
  // re-classification sweep compares it against the current set to decide
  // whether an uncategorized document is worth another attempt.
  categoryFolderSetHash: string;
  // Fingerprint of the destination folder's naming rule and subfolders, and
  // of the naming rule alone. The sweep re-organizes the document once the
  // folder's fingerprint has moved on; the rule's own hash tells a changed
  // rule from a new subfolder, which calls for a move but not a rename. Both
  // are null for a document filed under Uncategorized.
  organizationFingerprint: string | null;
  namingRuleHash: string | null;
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
    categoryPath: classification.categoryPath,
    categoryFolderId: classification.categoryFolderId,
    categoryFolderSetHash: classification.categoryFolderSetHash,
    organizationFingerprint: classification.organizationFingerprint,
    namingRuleHash: classification.namingRuleHash,
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

export interface OrganizationHistoryEntry {
  fileName: string;
  folderId: string;
  // Identifies the sweep that asked for the change. It also makes the entry
  // identical across redeliveries of one request, so arrayUnion stores it once.
  reorganizationBatchId: string;
}

/**
 * Append the name and folder a file is about to lose to its history
 *
 * Written before the file is touched, so the record to restore from exists
 * even when the change that follows is only half applied.
 *
 * @param firestore Firestore instance
 * @param documentPath Full path to the document
 * @param entry Name and folder the file has before the change
 */
export async function recordOrganizationHistory(
  firestore: Firestore,
  documentPath: string,
  entry: OrganizationHistoryEntry
): Promise<void> {
  await firestore.doc(documentPath).update({
    organizationHistory: FieldValue.arrayUnion(entry),
  });
}

export interface ReorganizationOutcome {
  status: Exclude<ReorganizationStatus, 'pending'>;
  previousFileName: string;
  // Set when the file was renamed.
  newFileName?: string;
  // Set when the file was moved into a subfolder.
  newFolder?: {
    id: string;
    path: string[];
    organizationFingerprint: string;
  };
  // Set when a name was generated under the destination's current rule,
  // whether or not it replaced the old one.
  namingRuleHash?: string;
  error?: string;
}

/**
 * Record how a re-organization request ended, and bring the document's own
 * name and folder fields in line with what was applied in Drive
 *
 * The outcome is written field by field under `reorganization` because the
 * sweeper owns the rest of that record (the batch and the folder the request
 * came from), which the reporter groups by.
 *
 * @param firestore Firestore instance
 * @param documentPath Full path to the document
 * @param outcome What the re-organization did
 */
export async function recordReorganizationOutcome(
  firestore: Firestore,
  documentPath: string,
  outcome: ReorganizationOutcome
): Promise<void> {
  await firestore.doc(documentPath).update({
    'reorganization.status': outcome.status,
    'reorganization.completedAt': new Date().toISOString(),
    'reorganization.previousFileName': outcome.previousFileName,
    ...(outcome.newFileName
      ? {
          'reorganization.newFileName': outcome.newFileName,
          renamedFileName: outcome.newFileName,
        }
      : {}),
    ...(outcome.newFolder
      ? {
          'reorganization.newFolderId': outcome.newFolder.id,
          'reorganization.newFolderPath': outcome.newFolder.path,
          categoryFolderId: outcome.newFolder.id,
          categoryPath: outcome.newFolder.path,
          organizationFingerprint: outcome.newFolder.organizationFingerprint,
        }
      : {}),
    ...(outcome.namingRuleHash
      ? { namingRuleHash: outcome.namingRuleHash }
      : {}),
    ...(outcome.error ? { 'reorganization.error': outcome.error } : {}),
  });
}
