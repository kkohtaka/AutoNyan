import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface CategoryFolder {
  id: string;
  name: string;
}

/**
 * List all folders within a specified parent folder in Google Drive
 * @param auth OAuth2 client for authentication
 * @param rootFolderId Parent folder ID to list subfolders from
 * @returns Array of category folders
 */
export async function listCategoryFolders(
  auth: OAuth2Client,
  rootFolderId: string
): Promise<CategoryFolder[]> {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  });

  if (!response.data.files) {
    return [];
  }

  return response.data.files.map((file) => ({
    id: file.id!,
    name: file.name!,
  }));
}

/**
 * Move a file to a different folder in Google Drive
 * @param auth OAuth2 client for authentication
 * @param fileId File ID to move
 * @param targetFolderId Destination folder ID
 */
export async function moveFileInDrive(
  auth: OAuth2Client,
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
