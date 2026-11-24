import { google } from 'googleapis';
import { DriveAuth } from 'autonyan-shared';

export interface FileState {
  name: string;
  parents: string[];
  // RFC 3339, absent when Drive reports none.
  modifiedTime?: string;
}

/**
 * Read a file's name, parent folder IDs and last-modified time
 *
 * Used to confirm a document is still where the pipeline left it, under the
 * name the pipeline gave it, before it is sent back through classification: a
 * file the user has since moved or renamed by hand must not be touched again.
 * The modified time rides along in the same call as the reference date for a
 * document whose stored one predates the field.
 *
 * A file the user has deleted or trashed is reported as gone rather than as
 * an error: its Firestore document outlives it, and a sweep that threw here
 * would be retried forever and never reach the documents behind it.
 *
 * @param auth Drive identity credentials
 * @param fileId File ID to inspect
 * @returns Name, parent folder IDs (empty when the file has none) and modified
 *   time, null when the file is no longer reachable
 */
export async function getFileState(
  auth: DriveAuth,
  fileId: string
): Promise<FileState | null> {
  const drive = google.drive({ version: 'v3', auth });

  try {
    const response = await drive.files.get({
      fileId,
      fields: 'name,parents,modifiedTime',
      supportsAllDrives: true,
    });

    return {
      name: response.data.name || '',
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
