import { createHash } from 'crypto';

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
