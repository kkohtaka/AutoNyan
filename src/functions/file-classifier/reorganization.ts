import { Firestore } from '@google-cloud/firestore';
import {
  CategoryFolder,
  DriveAuth,
  EXTRACTED_TEXTS_COLLECTION,
  folderOrganizationFingerprint,
  formatCategoryPath,
  listCategorySubtree,
  logger,
  namingRuleHash,
  resolveNamingRule,
} from 'autonyan-shared';
import { classifyWithGemini } from './classification';
import { listFileNamesInFolder, moveFileInDrive } from './drive-operations';
import {
  recordOrganizationHistory,
  recordReorganizationOutcome,
  ReorganizationOutcome,
} from './firestore-operations';
import { PageInfo } from './partial-input';
import { generateFileName, resolveRenamedFileName } from './rename';

export interface ReorganizationRequest {
  firestoreDocId: string;
  fileId: string;
  // Name the file had at ingestion. It is the source of the extension, and
  // what the name prompt is shown as the original name.
  fileName: string;
  extractedText: string;
  reorganizationBatchId: string;
  // Where the sweeper found the file, and under which name.
  currentFolderId: string;
  currentFileName: string;
  // Hash of the naming rule the current name was generated under.
  namingRuleHash?: string;
}

export interface ReorganizationContext {
  projectId: string;
  auth: DriveAuth;
  firestore: Firestore;
  categoryFolders: CategoryFolder[];
  pageInfo?: PageInfo;
}

/**
 * Bring a document that is already filed in line with the current state of
 * its folder: move it into a subfolder that now fits, and rename it when the
 * naming rule that applies to it has changed
 *
 * Only the document's own folder and the folders below it are offered as
 * destinations, so a re-organization never moves a file across categories.
 * Nothing is written to Drive when neither the folder nor the name changes.
 *
 * @returns What was done, as recorded on the Firestore document
 */
export async function reorganizeDocument(
  context: ReorganizationContext,
  request: ReorganizationRequest
): Promise<ReorganizationOutcome> {
  const { projectId, auth, firestore, categoryFolders, pageInfo } = context;
  const documentPath = `${EXTRACTED_TEXTS_COLLECTION}/${request.firestoreDocId}`;

  const finish = async (
    outcome: ReorganizationOutcome
  ): Promise<ReorganizationOutcome> => {
    await recordReorganizationOutcome(firestore, documentPath, outcome);
    return outcome;
  };

  const candidates = listCategorySubtree(
    categoryFolders,
    request.currentFolderId
  );

  // The folder was removed, or renamed out of the tree, after the sweep saw
  // it. There is nothing to organize the document against any more.
  if (candidates.length === 0) {
    logger.info('Folder is no longer a category, leaving file in place', {
      fileId: request.fileId,
    });
    return finish({
      status: 'unchanged',
      previousFileName: request.currentFileName,
    });
  }

  let destination = candidates[0];

  // A folder without subfolders has only one possible destination, so the
  // billable classification call is skipped.
  if (candidates.length > 1) {
    const classification = await classifyWithGemini(
      projectId,
      request.extractedText,
      candidates,
      pageInfo
    );

    logger.info('Re-organization classification result', { classification });

    // No match among the candidates means the document stays where it is: a
    // re-organization never sends a filed document back to Uncategorized.
    destination =
      candidates.find(
        (folder) => folder.id === classification.categoryFolderId
      ) ?? destination;
  }

  const moved = destination.id !== request.currentFolderId;

  // The name is regenerated only when the rule it was generated under no
  // longer applies. A document re-evaluated because a subfolder appeared, or
  // moved into a subfolder that inherits the same rule, keeps its name: the
  // model would otherwise reword names that already follow the rule.
  const namingRule = resolveNamingRule(categoryFolders, destination.id);
  const destinationRuleHash = namingRuleHash(namingRule);
  const renameDue =
    typeof request.namingRuleHash === 'string' &&
    request.namingRuleHash !== destinationRuleHash;

  let newFileName: string | null = null;

  if (renameDue) {
    const existingFileNames = await listFileNamesInFolder(
      auth,
      destination.id,
      request.fileId
    );

    const generated = await generateFileName(
      projectId,
      request.extractedText,
      request.fileName,
      existingFileNames,
      { pageInfo, namingRule }
    );

    newFileName = resolveRenamedFileName(
      generated,
      request.fileName,
      existingFileNames,
      request.currentFileName
    );

    logger.info('Re-organization file name result', {
      generated,
      newFileName,
    });
  }

  const applied: Pick<
    ReorganizationOutcome,
    'previousFileName' | 'newFileName' | 'newFolder' | 'namingRuleHash'
  > = {
    previousFileName: request.currentFileName,
    ...(newFileName ? { newFileName } : {}),
    ...(moved
      ? {
          newFolder: {
            id: destination.id,
            path: destination.path,
            organizationFingerprint: folderOrganizationFingerprint(
              categoryFolders,
              destination.id
            ),
          },
        }
      : {}),
    ...(renameDue ? { namingRuleHash: destinationRuleHash } : {}),
  };

  if (!moved && !newFileName) {
    logger.info('Re-organization changes nothing, leaving file in place', {
      fileId: request.fileId,
    });
    return finish({ status: 'unchanged', ...applied });
  }

  await recordOrganizationHistory(firestore, documentPath, {
    fileName: request.currentFileName,
    folderId: request.currentFolderId,
    reorganizationBatchId: request.reorganizationBatchId,
  });

  try {
    logger.info('Re-organizing file', {
      fileId: request.fileId,
      destination: formatCategoryPath(destination.path),
      moved,
      newFileName,
    });
    await moveFileInDrive(
      auth,
      request.fileId,
      destination.id,
      newFileName ?? undefined
    );
  } catch (moveError) {
    // Not retried, for the same reason the first filing does not retry a
    // failed move: the usual cause is a permission that never resolves on its
    // own. The document's name and folder fields are left as they were, so
    // they keep describing the file as it actually is.
    logger.warn('Failed to re-organize file in Drive', { error: moveError });
    return finish({
      status: 'failed',
      previousFileName: request.currentFileName,
      error: moveError instanceof Error ? moveError.message : String(moveError),
    });
  }

  return finish({ status: 'changed', ...applied });
}
