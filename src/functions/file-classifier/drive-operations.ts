import { google, drive_v3 } from 'googleapis';

export interface CategoryFolder {
  id: string;
  name: string;
}

/**
 * List all folders within a specified parent folder in Google Drive
 * @param auth GoogleAuth instance for authentication
 * @param rootFolderId Parent folder ID to list subfolders from
 * @returns Array of category folders
 */
export async function listCategoryFolders(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  rootFolderId: string
): Promise<CategoryFolder[]> {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files: drive_v3.Schema$File[] = response.data.files || [];

  return files.map((file: drive_v3.Schema$File) => ({
    id: file.id!,
    name: file.name!,
  }));
}

/**
 * Sleep for a specified duration
 * @param ms Milliseconds to sleep
 */
async function sleep(ms: number): Promise<void> {
  // eslint-disable-next-line no-undef
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Move a file to a different folder in Google Drive with retry logic
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to move
 * @param targetFolderId Destination folder ID
 * @param maxRetries Maximum number of retry attempts (default: 5)
 * @param baseDelay Base delay in ms for exponential backoff (default: 5000)
 */
export async function moveFileInDrive(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  fileId: string,
  targetFolderId: string,
  maxRetries: number = 5,
  baseDelay: number = 5000
): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Get current parent folders
      const file = await drive.files.get({
        fileId: fileId,
        fields: 'parents',
        supportsAllDrives: true,
      });

      const previousParents = file.data.parents?.join(',');

      // Move file by updating parents
      await drive.files.update({
        fileId: fileId,
        addParents: targetFolderId,
        removeParents: previousParents,
        fields: 'id, parents',
        supportsAllDrives: true,
      });

      // Success - return immediately
      return;
    } catch (error) {
      lastError = error as Error;
      const errorCode = (error as Error & { code?: number }).code;

      // Only retry on transient errors (403 permission denied, 404 not found)
      // These often indicate permission propagation delays in Google Drive
      const isRetryable = errorCode === 403 || errorCode === 404;

      if (!isRetryable || attempt === maxRetries) {
        // Non-retryable error or max retries exceeded - throw immediately
        throw error;
      }

      // Calculate delay with linear backoff (more predictable for permission propagation)
      // Delay increases linearly: 5s, 10s, 15s, 20s, 25s
      const delay = baseDelay * (attempt + 1);

      // eslint-disable-next-line no-console
      console.log(
        `File move attempt ${attempt + 1} failed (${errorCode}), retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw lastError || new Error('File move failed after all retries');
}
