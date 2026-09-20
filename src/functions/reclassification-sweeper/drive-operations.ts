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

/**
 * Read a file's parent folder IDs
 *
 * Used to confirm a document still sits in the Uncategorized folder before it
 * is sent back through classification: a file the user has already filed by
 * hand must not be moved again.
 *
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to inspect
 * @returns Parent folder IDs, empty when the file has none
 */
export async function getFileParents(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  fileId: string
): Promise<string[]> {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });

  return response.data.parents || [];
}
