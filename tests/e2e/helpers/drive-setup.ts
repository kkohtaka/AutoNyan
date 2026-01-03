import { drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Upload a test file to Google Drive
 *
 * @param drive - Drive API client
 * @param folderId - Parent folder ID
 * @param filePath - Local file path
 * @returns Uploaded file metadata
 */
export async function uploadTestFile(
  drive: drive_v3.Drive,
  folderId: string,
  filePath: string
): Promise<drive_v3.Schema$File> {
  const fileName = path.basename(filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Test file not found: ${filePath}`);
  }

  const fileStream = fs.createReadStream(filePath);

  try {
    const response = await drive.files.create({
      requestBody: {
        name: `e2e-test-${Date.now()}-${fileName}`,
        parents: [folderId],
      },
      media: {
        body: fileStream,
      },
      fields: 'id,name,mimeType',
    });

    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common Drive API errors
    if (errorMessage.includes('Unexpected Gaxios Error')) {
      throw new Error(
        `Failed to upload file to Google Drive.\n\n` +
          `This may be caused by:\n` +
          `  1. Expired or invalid credentials - run: gcloud auth application-default login\n` +
          `  2. Service account lacks access to folder ${folderId}\n` +
          `  3. Network connectivity issues\n\n` +
          `Original error: ${errorMessage}`
      );
    }

    if (errorMessage.includes('insufficient permissions')) {
      throw new Error(
        `Insufficient permissions to access Drive folder ${folderId}.\n\n` +
          `Ensure the service account or user has "Editor" access to this folder.\n\n` +
          `Original error: ${errorMessage}`
      );
    }

    throw error;
  }
}

/**
 * Clean up Google Drive files
 *
 * @param drive - Drive API client
 * @param fileIds - Array of file IDs to delete
 */
export async function cleanupDriveFiles(
  drive: drive_v3.Drive,
  fileIds: string[]
): Promise<void> {
  for (const fileId of fileIds) {
    try {
      await drive.files.delete({ fileId });
    } catch (error) {
      console.warn(`Failed to delete Drive file ${fileId}:`, error);
    }
  }
}

/**
 * Create a test folder in Google Drive
 *
 * @param drive - Drive API client
 * @param parentFolderId - Parent folder ID
 * @param folderName - Folder name
 * @returns Created folder ID
 */
export async function createTestFolder(
  drive: drive_v3.Drive,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  return response.data.id!;
}
