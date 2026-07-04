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
 * Move a file to a different folder in Google Drive
 *
 * The folders live on a shared drive, so the service account must hold the
 * fileOrganizer (Content Manager) role on them — writer is enough to edit
 * files but not to re-parent them, and yields a non-transient 403. That role
 * is granted by the share-drive-folders setup script; do not retry 403s here,
 * they never resolve on their own.
 *
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to move
 * @param targetFolderId Destination folder ID
 */
export async function moveFileInDrive(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  fileId: string,
  targetFolderId: string
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
    fields: 'id, parents',
    supportsAllDrives: true,
  });
}
