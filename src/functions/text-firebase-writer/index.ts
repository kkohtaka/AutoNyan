import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';

interface PageText {
  pageNumber: number;
  text: string;
  confidence: number;
}

interface ExtractedText {
  fileId: string;
  objectName: string;
  extractedText: string;
  confidence: number;
  pages: PageText[];
  extractedAt: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  contentHash: string;
  visionResultPath: string;
}

interface Result {
  message: string;
  firestoreDocId: string;
  textLength: number;
  confidence: number;
  pages: number;
  originalFileName: string;
}

interface VisionApiResponse {
  fullTextAnnotation?: {
    text?: string;
    pages?: Array<{
      confidence?: number;
    }>;
  };
}

interface VisionApiResult {
  responses?: VisionApiResponse[];
}

export const textFirebaseWriter = async (
  cloudEvent: CloudEvent<StorageObjectData>
): Promise<Result> => {
  try {
    const eventData = cloudEvent.data;
    if (!eventData) {
      throw new Error('No event data found in CloudEvent');
    }

    const { bucket, name: objectName, contentType } = eventData;

    if (!bucket || !objectName) {
      throw new Error('Missing required event data: bucket or objectName');
    }

    // Only process JSON files from Vision API
    if (contentType !== 'application/json') {
      // eslint-disable-next-line no-console
      console.log(`Skipping non-JSON file: ${objectName}`);
      throw new Error(`Unsupported file type: ${contentType}`);
    }

    // Initialize clients
    const storage = new Storage();
    const firestore = new Firestore();

    // Get the Vision API result file
    const file = storage.bucket(bucket).file(objectName);
    const [metadata] = await file.getMetadata();

    // Extract metadata
    const originalFileId = String(metadata.metadata?.originalFileId || '');
    const originalFileName = String(metadata.metadata?.originalFileName || '');
    const originalMimeType = String(metadata.metadata?.originalMimeType || '');
    const contentHash = String(metadata.metadata?.contentHash || '');
    const processedAt = String(metadata.metadata?.processedAt || '');

    if (!originalFileId || !originalFileName || !contentHash) {
      throw new Error('Missing required metadata from Vision API result file');
    }

    // eslint-disable-next-line no-console
    console.log(
      `Processing Vision API results for ${originalFileName} (${objectName})`
    );

    // Download and parse the Vision API result JSON
    const [fileContent] = await file.download();
    const visionResult: VisionApiResult = JSON.parse(
      fileContent.toString('utf-8')
    );

    if (!visionResult.responses || visionResult.responses.length === 0) {
      throw new Error('No responses found in Vision API result');
    }

    // Aggregate text from all pages
    let extractedText = '';
    let totalConfidence = 0;
    let pageCount = 0;
    const pages: PageText[] = [];

    for (const response of visionResult.responses) {
      if (response.fullTextAnnotation) {
        const pageText = response.fullTextAnnotation.text || '';
        const confidence =
          response.fullTextAnnotation.pages?.[0]?.confidence || 0;

        if (pageText.trim()) {
          extractedText += pageText;
          if (pageCount > 0) {
            extractedText += '\n'; // Add newline between pages
          }

          totalConfidence += confidence;
          pageCount++;

          pages.push({
            pageNumber: pageCount,
            text: pageText,
            confidence: confidence,
          });
        }
      }
    }

    const overallConfidence = pageCount > 0 ? totalConfidence / pageCount : 0;

    // Get file size from the original document storage
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    if (!projectId) {
      throw new Error('PROJECT_ID environment variable not set');
    }

    const documentBucket = `${projectId}-document-storage`;
    const originalObjectName = `documents/${contentHash}`;

    let fileSize = 0;
    try {
      const originalFile = storage
        .bucket(documentBucket)
        .file(originalObjectName);
      const [originalMetadata] = await originalFile.getMetadata();
      fileSize = parseInt(String(originalMetadata.size || '0'), 10);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Could not get original file size: ${error}`);
    }

    // Prepare data for Firestore
    const extractedTextDoc: ExtractedText = {
      fileId: originalFileId,
      objectName: originalObjectName,
      extractedText: extractedText,
      confidence: overallConfidence,
      pages: pages,
      extractedAt: processedAt || new Date().toISOString(),
      mimeType: originalMimeType || 'unknown',
      fileName: originalFileName,
      fileSize: fileSize,
      contentHash: contentHash,
      visionResultPath: `gs://${bucket}/${objectName}`,
    };

    // Store extracted text in Firestore
    const collection = firestore.collection('extracted_texts');
    const docRef = await collection.add(extractedTextDoc);

    const result = {
      message: `Successfully stored extracted text from ${originalFileName}`,
      firestoreDocId: docRef.id,
      textLength: extractedText.length,
      confidence: overallConfidence,
      pages: pages.length,
      originalFileName: originalFileName,
    };

    // eslint-disable-next-line no-console
    console.log(`Firebase storage completed: ${JSON.stringify(result)}`);

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    // eslint-disable-next-line no-console
    console.error('Firebase storage error:', error);

    throw new Error(`Firebase storage failed: ${errorMessage}`);
  }
};
