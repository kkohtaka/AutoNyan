import { createHash } from 'crypto';
import type { drive_v3 } from 'googleapis';

export interface CategoryFolder {
  id: string;
  name: string;
  // Folder names from the top-level category down to this folder.
  path: string[];
  // The category root for a top-level category.
  parentId: string;
  // The folder's Drive description, when the user wrote one. It states the
  // naming rule for files filed there and hints at what the folder holds.
  description?: string;
}

// Levels of folders below the category root that are classification targets.
// The bound is what keeps the Drive calls per classification constant: the
// tree is listed level by level, never folder by folder.
export const MAX_CATEGORY_DEPTH = 3;

// A folder whose name starts with this is the user's own and is skipped with
// everything below it.
const IGNORED_FOLDER_PREFIX = '_';

// One level is listed with a single query naming every parent. The query
// travels in the URL, so a very wide level is split to keep it bounded.
const MAX_PARENTS_PER_QUERY = 25;

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

const PATH_SEPARATOR = '/';

/**
 * Render a category path as the single string shown to the model and the user
 * @param path Folder names from the top-level category down
 * @returns The names joined into one path; a top-level category is its name
 */
export function formatCategoryPath(path: string[]): string {
  return path.join(PATH_SEPARATOR);
}

/**
 * List the category folders below the category root, subfolders included
 *
 * The Drive client is the caller's because the shared code is copied into
 * every function at build time, including ones that do not depend on
 * googleapis.
 *
 * @param drive Drive client of the calling function
 * @param rootFolderId Category root folder ID
 * @returns Every classification target down to MAX_CATEGORY_DEPTH, each parent
 *   directly followed by its subtree, siblings in Drive's name order
 */
export async function listCategoryTree(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<CategoryFolder[]> {
  const childrenByParent = new Map<string, CategoryFolder[]>();
  let parents = new Map<string, string[]>([[rootFolderId, []]]);

  for (
    let depth = 1;
    depth <= MAX_CATEGORY_DEPTH && parents.size > 0;
    depth++
  ) {
    const level = await listChildFolders(drive, parents);
    parents = new Map();

    for (const folder of level) {
      const siblings = childrenByParent.get(folder.parentId) ?? [];
      siblings.push(folder);
      childrenByParent.set(folder.parentId, siblings);
      parents.set(folder.id, folder.path);
    }
  }

  const tree: CategoryFolder[] = [];
  const appendSubtree = (parentId: string): void => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      tree.push(folder);
      appendSubtree(folder.id);
    }
  };
  appendSubtree(rootFolderId);

  return tree;
}

async function listChildFolders(
  drive: drive_v3.Drive,
  parents: Map<string, string[]>
): Promise<CategoryFolder[]> {
  const parentIds = [...parents.keys()];
  const folders: CategoryFolder[] = [];

  for (
    let start = 0;
    start < parentIds.length;
    start += MAX_PARENTS_PER_QUERY
  ) {
    const chunk = parentIds.slice(start, start + MAX_PARENTS_PER_QUERY);
    const parentClause = chunk.map((id) => `'${id}' in parents`).join(' or ');
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `(${parentClause}) and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
        fields: 'nextPageToken, files(id, name, description, parents)',
        orderBy: 'name',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of response.data.files ?? []) {
        const name = file.name!;
        if (name.startsWith(IGNORED_FOLDER_PREFIX)) {
          continue;
        }

        // With a single parent in the query the answer needs no `parents`
        // field, so a response that omits it still lists the folder.
        const parentId =
          (file.parents ?? []).find((id) => chunk.includes(id)) ??
          (chunk.length === 1 ? chunk[0] : undefined);
        if (!parentId) {
          continue;
        }

        folders.push({
          id: file.id!,
          name,
          path: [...parents.get(parentId)!, name],
          parentId,
          ...(file.description ? { description: file.description } : {}),
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return folders;
}

/**
 * Fingerprint of the set of category folders that existed when a document was
 * classified.
 *
 * Stored on every classified document so the re-classification sweep can tell
 * "already tried against these folders" from "the user has since added one".
 * Both the classifier (which writes it) and the sweeper (which compares it)
 * must derive it identically, which is why it lives here rather than in either
 * function.
 *
 * @param folderIds Category folder IDs, in any order
 * @returns Hex digest that depends only on the set, not on ordering
 */
export function categoryFolderSetHash(folderIds: string[]): string {
  return createHash('sha256')
    .update([...folderIds].sort().join(','))
    .digest('hex');
}
