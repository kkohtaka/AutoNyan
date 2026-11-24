import { createHash } from 'crypto';
import { CategoryFolder } from './category-folders';
import { resolveNamingRule } from './folder-description';

// Name of the Firestore collection that holds one document per processed file.
// The re-organization flow spans three functions that all query it.
export const EXTRACTED_TEXTS_COLLECTION = 'extracted_texts';

/**
 * State of one re-organization request, stored on the document under
 * `reorganization`.
 *
 * The sweeper writes the request, the classifier fills in the outcome, and the
 * reporter turns the outcomes of one batch into a single email per folder. The
 * shape lives here because all three must agree on it.
 */
export interface ReorganizationRecord {
  // Shared by every document one sweep republished.
  batchId: string;
  // The folder whose change triggered the request, which is the folder the
  // document sat in at the time.
  folderId: string;
  folderPath: string[];
  requestedAt: string;
  status: ReorganizationStatus;
  // False until the reporter has accounted for this request.
  reported: boolean;
  completedAt?: string;
  previousFileName?: string;
  // Set only when the file was renamed.
  newFileName?: string;
  // Set only when the file was moved into a subfolder.
  newFolderId?: string;
  newFolderPath?: string[];
  error?: string;
}

export type ReorganizationStatus =
  'pending' | 'changed' | 'unchanged' | 'failed';

/**
 * Fingerprint of a naming rule
 * @param namingRule Effective naming rule of a folder, undefined when it has
 *   none
 * @returns Hex digest; a folder without a rule has a digest of its own
 */
export function namingRuleHash(namingRule: string | undefined): string {
  return createHash('sha256')
    .update(namingRule ?? '')
    .digest('hex');
}

/**
 * Fingerprint of what decides how the documents in a folder are organized: the
 * naming rule that applies there and the subfolders a document could move into
 *
 * Stored on a document when it is filed. The sweep re-evaluates the document
 * once the fingerprint of its folder no longer matches the stored one, so the
 * classifier (which writes it) and the sweeper (which compares it) must derive
 * it identically.
 *
 * @param folders Category tree the folder belongs to
 * @param folderId Folder to fingerprint
 * @returns Hex digest that changes when the effective naming rule changes or a
 *   direct subfolder is added or removed
 */
export function folderOrganizationFingerprint(
  folders: CategoryFolder[],
  folderId: string
): string {
  const childFolderIds = folders
    .filter((folder) => folder.parentId === folderId)
    .map((folder) => folder.id)
    .sort();

  return createHash('sha256')
    .update(
      JSON.stringify({
        namingRuleHash: namingRuleHash(resolveNamingRule(folders, folderId)),
        childFolderIds,
      })
    )
    .digest('hex');
}

/**
 * Select a folder together with every folder below it
 * @param folders Category tree
 * @param folderId Folder at the top of the wanted subtree
 * @returns The folder followed by its descendants in tree order; empty when
 *   the folder is not part of the tree
 */
export function listCategorySubtree(
  folders: CategoryFolder[],
  folderId: string
): CategoryFolder[] {
  const subtreeIds = new Set<string>();
  const subtree: CategoryFolder[] = [];

  // A parent always precedes its children in the tree, so one pass is enough.
  for (const folder of folders) {
    if (folder.id === folderId || subtreeIds.has(folder.parentId)) {
      subtreeIds.add(folder.id);
      subtree.push(folder);
    }
  }

  return subtree;
}
