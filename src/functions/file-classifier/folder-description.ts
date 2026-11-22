import { CategoryFolder } from 'autonyan-shared';

// A folder description is free text anyone who can edit the folder may write,
// so it is bounded before it enters a prompt. The cap is generous enough for
// a naming rule with an example or two, and small next to the document text.
export const MAX_FOLDER_DESCRIPTION_LENGTH = 500;

/**
 * Normalize a Drive folder description for use in a prompt
 * @param description Raw description from the Drive listing
 * @returns Trimmed description capped at MAX_FOLDER_DESCRIPTION_LENGTH, or
 *   undefined when there is nothing usable
 */
export function normalizeFolderDescription(
  description: string | null | undefined
): string | undefined {
  const trimmed = description?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.substring(0, MAX_FOLDER_DESCRIPTION_LENGTH).trim();
}

/**
 * Find the naming rule that applies to a destination folder
 *
 * A subfolder without a description of its own follows the rule of the
 * nearest folder above it that has one, so a rule written on a category
 * covers every subfolder the user has not given a different rule.
 *
 * @param folders Category tree the destination belongs to
 * @param folderId Destination folder ID
 * @returns The nearest non-empty description from the destination up to its
 *   top-level category, or undefined when none of them has one
 */
export function resolveNamingRule(
  folders: CategoryFolder[],
  folderId: string
): string | undefined {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));

  for (
    let folder = foldersById.get(folderId);
    folder;
    folder = foldersById.get(folder.parentId)
  ) {
    const rule = normalizeFolderDescription(folder.description);
    if (rule) {
      return rule;
    }
  }

  return undefined;
}
