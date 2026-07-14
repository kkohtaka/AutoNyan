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

// Recent files best reflect a folder's current naming convention, so only the
// newest names are handed to the name-generation prompt.
const MAX_REFERENCE_FILE_NAMES = 20;

/**
 * List file names in a folder, most recently created first
 * @param auth GoogleAuth instance for authentication
 * @param folderId Folder ID to list files from
 * @returns File names capped at MAX_REFERENCE_FILE_NAMES
 */
export async function listFileNamesInFolder(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  folderId: string
): Promise<string[]> {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(name)',
    orderBy: 'createdTime desc',
    pageSize: MAX_REFERENCE_FILE_NAMES,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files: drive_v3.Schema$File[] = response.data.files || [];

  return files.map((file: drive_v3.Schema$File) => file.name!);
}

/**
 * Move (and optionally rename) a file in Google Drive with a single
 * files.update call
 *
 * The folders live on a shared drive, so the service account must hold the
 * fileOrganizer (Content Manager) role on them — writer is enough to edit
 * files (including renames) but not to re-parent them, and yields a
 * non-transient 403. That role is granted by the share-drive-folders setup
 * script; do not retry 403s here, they never resolve on their own.
 *
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to move
 * @param targetFolderId Destination folder ID
 * @param newName New file name; omit to keep the current name
 */
export async function moveFileInDrive(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  fileId: string,
  targetFolderId: string,
  newName?: string
): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });

  const file = await drive.files.get({
    fileId: fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });

  const previousParents = file.data.parents?.join(',');

  await drive.files.update({
    fileId: fileId,
    addParents: targetFolderId,
    removeParents: previousParents,
    requestBody: newName ? { name: newName } : {},
    fields: 'id, parents',
    supportsAllDrives: true,
  });
}
