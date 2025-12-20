import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { drive_v3 } from 'googleapis';

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
  auth: GoogleAuth,
  rootFolderId: string
): Promise<CategoryFolder[]> {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  });

  const files: drive_v3.Schema$File[] = response.data.files || [];

  return files.map((file: drive_v3.Schema$File) => ({
    id: file.id!,
    name: file.name!,
  }));
}

/**
 * Move a file to a different folder in Google Drive
 * @param auth GoogleAuth instance for authentication
 * @param fileId File ID to move
 * @param targetFolderId Destination folder ID
 */
export async function moveFileInDrive(
  auth: GoogleAuth,
  fileId: string,
  targetFolderId: string
): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });

  // Get current parent folders
  const file = await drive.files.get({
    fileId: fileId,
    fields: 'parents',
  });

  const previousParents = file.data.parents?.join(',');

  // Move file by updating parents
  await drive.files.update({
    fileId: fileId,
    addParents: targetFolderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });
}
