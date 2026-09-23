import { drive_v3, google } from 'googleapis';

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

export interface FileState {
  parents: string[];
  // RFC 3339, absent when Drive reports none.
  modifiedTime?: string;
}

/**
 * Read a file's parent folder IDs and its last-modified time
 *
 * Used to confirm a document still sits in the Uncategorized folder before it
 * is sent back through classification: a file the user has already filed by
 * hand must not be moved again. The modified time rides along in the same
 * call as the reference date for a document whose stored one predates the
 * field.
 *
 * A file the user has deleted or trashed is reported as gone rather than as
 * an error: its Firestore document outlives it, and a sweep that threw here
 * would be retried forever and never reach the documents behind it.
 *
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to inspect
 * @returns Parent folder IDs (empty when the file has none) and modified time,
 *   null when the file is no longer reachable
 */
export async function getFileState(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  fileId: string
): Promise<FileState | null> {
  const drive = google.drive({ version: 'v3', auth });

  try {
    const response = await drive.files.get({
      fileId,
      fields: 'parents,modifiedTime',
      supportsAllDrives: true,
    });

    return {
      parents: response.data.parents || [],
      ...(response.data.modifiedTime
        ? { modifiedTime: response.data.modifiedTime }
        : {}),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: number | string } | null)?.code;

  return code === 404 || code === '404';
}
