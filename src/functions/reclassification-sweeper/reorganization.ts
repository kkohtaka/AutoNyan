import { Firestore } from '@google-cloud/firestore';
import { Topic } from '@google-cloud/pubsub';
import {
  CategoryFolder,
  DriveAuth,
  EXTRACTED_TEXTS_COLLECTION,
  folderOrganizationFingerprint,
  logger,
  namingRuleHash,
  ReorganizationRecord,
  resolveNamingRule,
} from 'autonyan-shared';
import { getFileState } from './drive-operations';

// Deciding whether a document is due needs only these. The extracted text is
// by far the largest field and every filed document is looked at on every
// sweep, so it is fetched separately for the few that are republished.
const TRIAGE_FIELDS = [
  'fileId',
  'fileName',
  'originalFileName',
  'renamedFileName',
  'organizationFingerprint',
  'namingRuleHash',
];

export interface ReorganizationSweepOptions {
  firestore: Firestore;
  topic: Topic;
  auth: DriveAuth;
  categoryFolders: CategoryFolder[];
  // Documents this sweep may still republish.
  limit: number;
  batchId: string;
}

export interface ReorganizationSweepResult {
  candidates: number;
  republished: number;
  skipped: number;
}

/**
 * Send documents already filed in a category folder back through the
 * classifier once that folder's naming rule or subfolders have changed
 *
 * The stored fingerprint bounds the work the same way the folder-set hash
 * does for the Uncategorized sweep: a document is reconsidered once per change
 * to its folder and not at all while the folder stays the same.
 *
 * @returns How many documents were due, republished and passed over
 */
export async function sweepFiledDocuments(
  options: ReorganizationSweepOptions
): Promise<ReorganizationSweepResult> {
  const { firestore, topic, auth, categoryFolders, limit, batchId } = options;

  let candidates = 0;
  let republished = 0;
  let skipped = 0;

  for (const folder of categoryFolders) {
    if (republished >= limit) {
      break;
    }

    const fingerprint = folderOrganizationFingerprint(
      categoryFolders,
      folder.id
    );
    const ruleHash = namingRuleHash(
      resolveNamingRule(categoryFolders, folder.id)
    );

    const snapshot = await firestore
      .collection(EXTRACTED_TEXTS_COLLECTION)
      .where('categoryFolderId', '==', folder.id)
      .select(...TRIAGE_FIELDS)
      .get();

    for (const doc of snapshot.docs) {
      if (republished >= limit) {
        logger.info('Reached the per-sweep limit, deferring the rest', {
          limit,
        });
        break;
      }

      const triage = doc.data();

      if (triage.organizationFingerprint === fingerprint) {
        continue;
      }

      // A document filed before fingerprints were recorded says nothing about
      // the folder it was filed under, so there is no change to detect. It is
      // adopted under the folder's current state rather than re-evaluated:
      // otherwise the first sweep after the field was introduced would rename
      // every document the pipeline ever filed.
      if (typeof triage.organizationFingerprint !== 'string') {
        await doc.ref.update({
          organizationFingerprint: fingerprint,
          namingRuleHash: ruleHash,
        });
        continue;
      }

      candidates++;

      const skip = async (reason: string): Promise<void> => {
        logger.info('Skipping re-organization of document', {
          firestoreDocId: doc.id,
          reason,
        });
        // Recorded so the document is not reconsidered until the folder
        // changes again.
        await doc.ref.update({ organizationFingerprint: fingerprint });
        skipped++;
      };

      const fileId = String(triage.fileId || '');
      const fileState = fileId ? await getFileState(auth, fileId) : null;

      if (fileState === null) {
        await skip('Drive file is gone');
        continue;
      }

      // A file the user has moved or renamed by hand is theirs: the pipeline
      // only reorganizes what is still exactly as it left it.
      if (!fileState.parents.includes(folder.id)) {
        await skip('file was moved by hand');
        continue;
      }

      const originalFileName = String(
        triage.originalFileName || triage.fileName || ''
      );
      const knownNames = [triage.renamedFileName, originalFileName].filter(
        (name) => typeof name === 'string' && name !== ''
      );
      if (!knownNames.includes(fileState.name)) {
        await skip('file was renamed by hand');
        continue;
      }

      const stored = (await doc.ref.get()).data() ?? {};
      const extractedText = String(stored.extractedText || '');

      if (!extractedText) {
        await skip('no stored extracted text');
        continue;
      }

      const request: ReorganizationRecord = {
        batchId,
        folderId: folder.id,
        folderPath: folder.path,
        requestedAt: new Date().toISOString(),
        status: 'pending',
        reported: false,
      };

      // Written before publishing: the classifier fills in the outcome on
      // this record, and writing the request after it could overwrite an
      // outcome that had already arrived.
      await doc.ref.update({ reorganization: request });

      await topic.publishMessage({
        json: {
          firestoreDocId: doc.id,
          fileId,
          fileName: originalFileName,
          extractedText,
          confidence: Number(stored.confidence || 0),
          ...(typeof stored.totalPages === 'number' &&
          typeof stored.includedPages === 'number'
            ? {
                totalPages: stored.totalPages,
                includedPages: stored.includedPages,
              }
            : {}),
          reorganization: true,
          reorganizationBatchId: batchId,
          currentFolderId: folder.id,
          currentFileName: fileState.name,
          ...(typeof triage.namingRuleHash === 'string'
            ? { namingRuleHash: triage.namingRuleHash }
            : {}),
        },
        attributes: {
          operation: 'file-reorganization',
          fileId,
        },
      });

      // Written after publishing, like the folder-set hash, so a document is
      // republished at most once per change even if the classifier fails.
      await doc.ref.update({ organizationFingerprint: fingerprint });

      republished++;

      logger.info('Republished document for re-organization', {
        firestoreDocId: doc.id,
        fileId,
        batchId,
      });
    }
  }

  return { candidates, republished, skipped };
}
