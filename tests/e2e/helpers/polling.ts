import { Storage } from '@google-cloud/storage';
import { Firestore, DocumentData } from '@google-cloud/firestore';

export interface PollOptions {
  timeout: number;
  interval: number;
  errorOnTimeout?: boolean;
}

const DEFAULT_OPTIONS: PollOptions = {
  timeout: 60000,
  interval: 2000,
  errorOnTimeout: true,
};

export interface StorageObjectInfo {
  name: string;
  metadata?: Record<string, string | number | boolean | null> | undefined;
  contentType?: string;
  size?: number;
}

/**
 * Poll for a Cloud Storage object matching the predicate
 *
 * @param storage - Storage client
 * @param bucketName - Bucket name
 * @param predicate - Function to test if file matches
 * @param options - Polling options
 * @returns Storage object information
 */
export async function pollForStorageObject(
  storage: Storage,
  bucketName: string,
  predicate: (
    fileName: string,
    metadata?: { [key: string]: string | number | boolean | null }
  ) => boolean,
  options: Partial<PollOptions> = {}
): Promise<StorageObjectInfo | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeout) {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles();

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      if (predicate(file.name, metadata.metadata)) {
        return {
          name: file.name,
          metadata: metadata.metadata,
          contentType: metadata.contentType,
          size: metadata.size ? parseInt(String(metadata.size), 10) : undefined,
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, opts.interval));
  }

  if (opts.errorOnTimeout) {
    throw new Error(
      `Timeout waiting for storage object in bucket ${bucketName} after ${opts.timeout}ms`
    );
  }

  return null;
}

/**
 * Poll for a Firestore document matching the predicate
 *
 * @param firestore - Firestore client
 * @param collectionName - Collection name
 * @param predicate - Function to test if document matches
 * @param options - Polling options
 * @returns Document data
 */
export async function pollForFirestoreDocument<T extends DocumentData>(
  firestore: Firestore,
  collectionName: string,
  predicate: (doc: T) => boolean,
  options: Partial<PollOptions> = {}
): Promise<T | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeout) {
    const snapshot = await firestore.collection(collectionName).get();

    const matchingDoc = snapshot.docs.find((doc) => predicate(doc.data() as T));

    if (matchingDoc) {
      return matchingDoc.data() as T;
    }

    await new Promise((resolve) => setTimeout(resolve, opts.interval));
  }

  if (opts.errorOnTimeout) {
    throw new Error(
      `Timeout waiting for Firestore document in ${collectionName} after ${opts.timeout}ms`
    );
  }

  return null;
}

/**
 * Wait for Vision API processing to complete
 *
 * @param storage - Storage client
 * @param bucketName - Bucket name
 * @param outputPath - Output path prefix
 * @param timeout - Timeout in milliseconds
 * @returns True if Vision API processing completed
 */
export async function waitForVisionCompletion(
  storage: Storage,
  bucketName: string,
  outputPath: string,
  timeout: number = 180000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: outputPath });

    // Vision API creates output-*.json files when complete
    const hasOutput = files.some(
      (file) => file.name.includes('output-') && file.name.endsWith('.json')
    );

    if (hasOutput) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 10000)); // Check every 10s
  }

  throw new Error(`Vision API processing timeout after ${timeout}ms`);
}

/**
 * Poll for a Google Drive file to be in a specific folder
 *
 * @param drive - Drive API client
 * @param fileId - File ID to check
 * @param expectedFolderId - Expected parent folder ID
 * @param options - Polling options
 * @returns True if file is in expected folder
 */
export async function pollForDriveFileLocation(
  drive: any,
  fileId: string,
  expectedFolderId: string,
  options: Partial<PollOptions> = {}
): Promise<boolean> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeout) {
    try {
      const fileMetadata = await drive.files.get({
        fileId,
        fields: 'parents',
        supportsAllDrives: true,
      });

      if (fileMetadata.data.parents?.includes(expectedFolderId)) {
        return true;
      }
    } catch (error) {
      // File might be temporarily inaccessible during move operation
      // Continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, opts.interval));
  }

  if (opts.errorOnTimeout) {
    throw new Error(
      `Timeout waiting for file ${fileId} to be moved to folder ${expectedFolderId} after ${opts.timeout}ms`
    );
  }

  return false;
}
