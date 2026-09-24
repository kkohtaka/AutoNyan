import { Storage } from '@google-cloud/storage';
import { logger } from 'autonyan-shared';

export interface SourceDocument {
  mimeType: string;
  // Base64, as Gemini takes inline data.
  data: string;
}

// Of the formats the pipeline accepts, the ones Gemini reads as a document.
// Office files, TIFF and GIF stay on the OCR text alone.
const GEMINI_DOCUMENT_MIME_TYPES = ['application/pdf'];

// The file is sent inline, and base64 grows it by a third; this keeps the
// request under Vertex AI's 20 MB inline-data limit.
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/**
 * Load the stored source file so Gemini sees the document's layout, which the
 * OCR text flattens.
 * @param bucketName Document-storage bucket
 * @param objectName Object the source file was stored under
 * @returns The file, or null when Gemini cannot take it and the OCR text has
 *   to stand alone
 */
export async function loadSourceDocument(
  bucketName: string,
  objectName: string
): Promise<SourceDocument | null> {
  const file = new Storage().bucket(bucketName).file(objectName);

  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      logger.warn('Source document not found, using OCR text only', {
        objectName,
      });
      return null;
    }
    throw error;
  }

  const mimeType = metadata.contentType || '';
  const size = Number(metadata.size || 0);

  if (!GEMINI_DOCUMENT_MIME_TYPES.includes(mimeType)) {
    logger.info('Source document format not sent to Gemini', {
      objectName,
      mimeType,
    });
    return null;
  }

  if (size > MAX_SOURCE_BYTES) {
    logger.warn('Source document too large to send inline, using OCR text', {
      objectName,
      size,
    });
    return null;
  }

  const [content] = await file.download();
  return { mimeType, data: content.toString('base64') };
}
