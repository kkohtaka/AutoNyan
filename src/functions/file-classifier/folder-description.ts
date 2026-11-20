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
