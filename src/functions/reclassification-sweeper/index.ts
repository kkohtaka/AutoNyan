import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  categoryFolderSetHash,
  createErrorResponse,
  logger,
} from 'autonyan-shared';
import { google } from 'googleapis';
import { getFileState, listCategoryFolders } from './drive-operations';

const EXTRACTED_TEXTS_COLLECTION = 'extracted_texts';

// Upper bound on documents republished in a single sweep. The folder-set hash
// is written back per document as it is published, so a backlog drains over
// consecutive sweeps rather than turning one schedule tick into an unbounded
// burst of billable classification calls.
const MAX_DOCUMENTS_PER_SWEEP = 50;

interface Result {
  message: string;
  candidates: number;
  republished: number;
  skipped: number;
}

/**
 * Cloud Function triggered on a schedule that sends documents left in the
 * Uncategorized folder back through classification once the set of category
 * folders has changed.
 *
 * Documents are matched on `category: null`, which only the classifier writes
 * — a document still in flight has no `category` field at all, so the sweep
 * cannot race the live pipeline. The stored folder-set hash bounds the work:
 * each document is retried exactly once per change to the category folders,
 * and not at all while they stay the same.
 */
export const reclassificationSweeper = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    logger.info('Received CloudEvent', { cloudEvent });

    const categoryRootFolderId = process.env.CATEGORY_ROOT_FOLDER_ID;
    const uncategorizedFolderId = process.env.UNCATEGORIZED_FOLDER_ID;

    if (!categoryRootFolderId || !uncategorizedFolderId) {
      throw new Error(
        'Missing required environment variables: CATEGORY_ROOT_FOLDER_ID or UNCATEGORIZED_FOLDER_ID'
      );
    }

    const classifierTopicName = process.env.FILE_CLASSIFIER_TOPIC;
    if (!classifierTopicName) {
      throw new Error(
        'Missing required environment variable: FILE_CLASSIFIER_TOPIC'
      );
    }

    // The sweep only inspects Drive: it lists the category folders and reads a
    // file's parents. Moving the file is the classifier's job.
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const categoryFolders = await listCategoryFolders(
      auth,
      categoryRootFolderId
    );
    const currentFolderSetHash = categoryFolderSetHash(
      categoryFolders.map((folder) => folder.id)
    );

    logger.info('Fetched category folders', {
      count: categoryFolders.length,
      currentFolderSetHash,
    });

    // No folders means classification has nothing to match against, so a
    // republished document would only be filed under Uncategorized again. It
    // is also what an unshared category root looks like — Drive answers a
    // folder it cannot see with an empty listing rather than an error — so the
    // sweep stops instead of recording the empty set as a folder generation.
    if (categoryFolders.length === 0) {
      logger.warn('No category folders are visible, skipping the sweep', {
        categoryRootFolderId,
      });

      return {
        message: 'No category folders are visible, sweep skipped',
        candidates: 0,
        republished: 0,
        skipped: 0,
      };
    }

    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({ databaseId });

    const snapshot = await firestore
      .collection(EXTRACTED_TEXTS_COLLECTION)
      .where('category', '==', null)
      .get();

    logger.info('Found uncategorized documents', {
      candidates: snapshot.size,
    });

    const pubsub = new PubSub();
    const topic = pubsub.topic(classifierTopicName);

    let republished = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
      if (republished >= MAX_DOCUMENTS_PER_SWEEP) {
        logger.info('Reached the per-sweep limit, deferring the rest', {
          limit: MAX_DOCUMENTS_PER_SWEEP,
        });
        break;
      }

      const data = doc.data();

      if (data.categoryFolderSetHash === currentFolderSetHash) {
        skipped++;
        continue;
      }

      const fileId = String(data.fileId || '');
      const extractedText = String(data.extractedText || '');

      // Re-running OCR is out of scope for the sweep, so a document without
      // stored text can never be classified here. Record the current hash so
      // it is not reconsidered until the folders change again.
      if (!fileId || !extractedText) {
        logger.info('Skipping document without a file ID or extracted text', {
          firestoreDocId: doc.id,
        });
        await doc.ref.update({
          categoryFolderSetHash: currentFolderSetHash,
        });
        skipped++;
        continue;
      }

      const fileState = await getFileState(auth, fileId);

      if (fileState === null) {
        logger.info('Skipping document whose Drive file is gone', {
          firestoreDocId: doc.id,
          fileId,
        });
        await doc.ref.update({
          categoryFolderSetHash: currentFolderSetHash,
        });
        skipped++;
        continue;
      }

      if (!fileState.parents.includes(uncategorizedFolderId)) {
        logger.info('Skipping document already filed elsewhere', {
          firestoreDocId: doc.id,
          fileId,
        });
        await doc.ref.update({
          categoryFolderSetHash: currentFolderSetHash,
        });
        skipped++;
        continue;
      }

      // Calendar registration resolves year-less dates against this, and
      // without it falls back to the sweep date, which can be months after
      // the document was written. Documents extracted before the field was
      // stored take Drive's current value: the classifier's rename may have
      // bumped it by a day, which is still the right month and year.
      const modifiedTime =
        String(data.modifiedTime || '') || fileState.modifiedTime;

      await topic.publishMessage({
        json: {
          firestoreDocId: doc.id,
          fileId,
          fileName: String(data.fileName || ''),
          extractedText,
          confidence: Number(data.confidence || 0),
          ...(modifiedTime ? { modifiedTime } : {}),
          ...(data.objectName ? { objectName: String(data.objectName) } : {}),
          reclassification: true,
        },
        attributes: {
          operation: 'file-classification',
          fileId,
        },
      });

      // Written here rather than left to the classifier so that a document is
      // republished at most once per folder-set change even if the
      // classification itself fails.
      await doc.ref.update({
        categoryFolderSetHash: currentFolderSetHash,
      });

      republished++;

      logger.info('Republished document for classification', {
        firestoreDocId: doc.id,
        fileId,
      });
    }

    const result = {
      message: `Re-classification sweep republished ${republished} of ${snapshot.size} uncategorized documents`,
      candidates: snapshot.size,
      republished,
      skipped,
    };

    logger.info('Re-classification sweep completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'reclassificationSweeper');

    logger.error('Re-classification sweep error', { error: errorResponse });

    // Unlike the event-driven stages, this one has no permanent-failure ACK
    // path: it parses no message body, so none of the error types
    // isPermanentError recognises can arise here. Every failure is retried.
    throw new Error(`Re-classification sweep failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};
