import { drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Upload a test file to Google Drive
 *
 * @param drive - Drive API client
 * @param folderId - Parent folder ID
 * @param filePath - Local file path
 * @param serviceAccountEmails - Optional service account emails to share file with
 * @param mimeType - Optional explicit MIME type; without it Drive sniffs the
 *                   content, which the negative E2E case must prevent (HTML
 *                   bytes must be stored as application/pdf)
 * @returns Uploaded file metadata
 */
export async function uploadTestFile(
  drive: drive_v3.Drive,
  folderId: string,
  filePath: string,
  serviceAccountEmails?: string[],
  mimeType?: string
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
        ...(mimeType ? { mimeType } : {}),
        body: fileStream,
      },
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });

    const fileId = response.data.id!;

    // Share file with service accounts if provided
    if (serviceAccountEmails && serviceAccountEmails.length > 0) {
      console.log(
        `Sharing file ${fileId} with ${serviceAccountEmails.length} service account(s)...`
      );
      for (const email of serviceAccountEmails) {
        try {
          await drive.permissions.create({
            fileId: fileId,
            requestBody: {
              type: 'user',
              role: 'writer',
              emailAddress: email,
            },
            sendNotificationEmail: false,
            supportsAllDrives: true,
          });
          console.log(`  ✅ Successfully shared file with ${email}`);
        } catch (error) {
          console.warn(
            `  ❌ Failed to share file ${fileId} with ${email}:`,
            error
          );
        }
      }
    }

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
 * Move a Drive item to the trash
 *
 * E2E cleanup must trash instead of permanently deleting: in a shared drive,
 * files.delete requires the Manager role, while the CI service account holds
 * only fileOrganizer (Content Manager), which can trash. Trashed items are
 * purged automatically after 30 days.
 *
 * @param drive - Drive API client
 * @param fileId - Item ID to trash
 */
export async function trashDriveItem(
  drive: drive_v3.Drive,
  fileId: string
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
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
  folderName: string,
  serviceAccountEmails?: string[]
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
      // Public custom property so cleanup sweeps can identify e2e artifacts
      // regardless of identity or folder name (test category folders share
      // their display name with real category folders)
      properties: { e2eTest: 'true' },
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const folderId = response.data.id!;

  // Share folder with service accounts if provided
  if (serviceAccountEmails && serviceAccountEmails.length > 0) {
    console.log(
      `Sharing folder ${folderId} with ${serviceAccountEmails.length} service account(s)...`
    );
    for (const email of serviceAccountEmails) {
      try {
        await drive.permissions.create({
          fileId: folderId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: email,
          },
          sendNotificationEmail: false,
          supportsAllDrives: true,
        });
        console.log(`  ✅ Successfully shared with ${email}`);
      } catch (error) {
        console.warn(
          `  ❌ Failed to share folder ${folderId} with ${email}:`,
          error
        );
      }
    }
  } else {
    console.log('No service accounts to share folder with');
  }

  return folderId;
}
