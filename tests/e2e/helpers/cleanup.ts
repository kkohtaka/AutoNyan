import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { drive_v3 } from 'googleapis';

export interface CleanupContext {
  drive: drive_v3.Drive;
  storage: Storage;
  firestore: Firestore;
  testFolderId?: string;
  testFileId?: string;
  contentHash?: string;
}

/**
 * Clean up test resources created during E2E tests
 *
 * @param context - Cleanup context containing clients and resource identifiers
 */
export async function cleanupTestResources(
  context: CleanupContext
): Promise<void> {
  const { drive, storage, firestore, testFileId, contentHash } = context;

  const cleanupTasks: Promise<void>[] = [];

  // Cleanup Drive files
  if (testFileId) {
    cleanupTasks.push(
      drive.files
        .delete({ fileId: testFileId })
        .then(() => undefined)
        .catch((err) =>
          console.warn(`Failed to cleanup Drive file ${testFileId}:`, err)
        )
    );
  }

  // Cleanup Storage objects
  if (contentHash) {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    const environment = process.env.ENVIRONMENT || 'staging';

    const buckets = [
      `${projectId}-${environment}-document-storage`,
      `${projectId}-${environment}-vision-results`,
    ];

    for (const bucketName of buckets) {
      cleanupTasks.push(cleanupStorageBucket(storage, bucketName, contentHash));
    }
  }

  // Cleanup Firestore documents
  if (testFileId) {
    cleanupTasks.push(
      cleanupFirestoreDocuments(firestore, 'extracted_texts', testFileId)
    );
  }

  await Promise.allSettled(cleanupTasks);
}

/**
 * Clean up Storage bucket objects by content hash prefix
 *
 * @param storage - Storage client
 * @param bucketName - Bucket name
 * @param contentHash - Content hash prefix
 */
async function cleanupStorageBucket(
  storage: Storage,
  bucketName: string,
  contentHash: string
): Promise<void> {
  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({
      prefix: `documents/${contentHash}`,
    });

    await Promise.all(
      files.map((file) =>
        file
          .delete()
          .catch((err) => console.warn(`Failed to delete ${file.name}:`, err))
      )
    );
  } catch (error) {
    console.warn(`Failed to cleanup bucket ${bucketName}:`, error);
  }
}

/**
 * Clean up Firestore documents by file ID
 *
 * @param firestore - Firestore client
 * @param collectionName - Collection name
 * @param fileId - File ID to match
 */
async function cleanupFirestoreDocuments(
  firestore: Firestore,
  collectionName: string,
  fileId: string
): Promise<void> {
  try {
    const snapshot = await firestore
      .collection(collectionName)
      .where('fileId', '==', fileId)
      .get();

    await Promise.all(
      snapshot.docs.map((doc) =>
        doc.ref
          .delete()
          .catch((err) =>
            console.warn(`Failed to delete document ${doc.id}:`, err)
          )
      )
    );
  } catch (error) {
    console.warn(
      `Failed to cleanup Firestore collection ${collectionName}:`,
      error
    );
  }
}

/**
 * Force cleanup of orphaned resources by timestamp
 * Useful for cleaning up after failed tests in CI
 *
 * @param context - Cleanup context
 * @param olderThan - Delete resources older than this date
 */
export async function forceCleanupByTimestamp(
  context: CleanupContext,
  olderThan: Date
): Promise<void> {
  const { storage, firestore } = context;
  const environment = process.env.ENVIRONMENT || 'staging';
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;

  if (!projectId) {
    console.warn('PROJECT_ID not set, skipping force cleanup');
    return;
  }

  // Clean Storage objects with e2e-test metadata
  const buckets = [
    `${projectId}-${environment}-document-storage`,
    `${projectId}-${environment}-vision-results`,
  ];

  for (const bucketName of buckets) {
    try {
      const bucket = storage.bucket(bucketName);
      const [files] = await bucket.getFiles();

      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const createdTime = new Date(metadata.timeCreated!);

        if (createdTime < olderThan && metadata.metadata?.testRun === 'e2e') {
          await file.delete().catch(console.warn);
        }
      }
    } catch (error) {
      console.warn(`Failed to force cleanup bucket ${bucketName}:`, error);
    }
  }

  // Clean Firestore documents
  try {
    const snapshot = await firestore
      .collection('extracted_texts')
      .where('extractedAt', '<', olderThan.toISOString())
      .get();

    await Promise.all(
      snapshot.docs
        .filter((doc) => doc.data().fileName?.includes('e2e-test'))
        .map((doc) => doc.ref.delete())
    );
  } catch (error) {
    console.warn('Failed to force cleanup Firestore:', error);
  }
}
