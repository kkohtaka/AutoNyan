import { Bucket, File, Storage } from '@google-cloud/storage';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { PubSub } from '@google-cloud/pubsub';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  logger,
  parseStorageEvent,
  PermanentError,
} from 'autonyan-shared';

interface Result {
  message: string;
  objectName: string;
  outputBucket: string;
  outputPath: string;
  operationId: string;
  skipped?: boolean;
}

// Vision asyncBatchAnnotateFiles only accepts these input types; every other
// image format must go through the synchronous batchAnnotateImages API.
const VISION_FILE_MIME_TYPES = ['application/pdf', 'image/tiff', 'image/gif'];

const VISION_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/bmp',
  'image/webp',
];

const SUPPORTED_MIME_TYPES = [
  'text/plain',
  ...VISION_FILE_MIME_TYPES,
  ...VISION_IMAGE_MIME_TYPES,
];

// Pages per Vision output shard. Vision writes one object per batch, so a
// document longer than this arrives in several shards (see mergeVisionShards).
const VISION_BATCH_SIZE = 20;

const SHARD_NAME_PATTERN = /output-(\d+)-to-(\d+)\.json$/;

interface VisionShardResponse {
  fullTextAnnotation?: {
    text?: string;
    pages?: Array<{ confidence?: number }>;
  };
  error?: unknown;
}

interface VisionShardResult {
  responses?: VisionShardResponse[];
}

/**
 * Keep only the parts of a Vision response the downstream writer reads.
 *
 * A full annotation carries the block/paragraph/word/symbol tree with
 * bounding boxes for every page, which is nearly all of a shard's size and
 * nothing downstream consumes. Dropping it as each shard is parsed keeps the
 * merged object, and the writer's memory while parsing it, proportional to
 * the document's text rather than its page count.
 */
function slimVisionResponse(
  response: VisionShardResponse
): VisionShardResponse {
  const slim: VisionShardResponse = {};
  if (response.fullTextAnnotation) {
    const { text, pages } = response.fullTextAnnotation;
    slim.fullTextAnnotation = { text };
    if (pages && pages.length > 0) {
      slim.fullTextAnnotation.pages = [{ confidence: pages[0].confidence }];
    }
  }
  if (response.error !== undefined) {
    slim.error = response.error;
  }
  return slim;
}

/**
 * Read every shard Vision wrote under a prefix and concatenate their
 * responses in page order.
 *
 * The downstream writer treats one result object as one document, so a
 * sharded output has to be merged here or a long document is stored and
 * classified once per shard. Shards are sorted on the numeric start page in
 * their name: the bucket lists them lexicographically, which puts
 * `output-101-to-120` before `output-21-to-40`.
 *
 * @param bucket Vision results bucket
 * @param rawPath Prefix the operation wrote its shards under
 * @returns Merged responses and the shard objects they came from
 */
async function mergeVisionShards(
  bucket: Bucket,
  rawPath: string
): Promise<{ responses: VisionShardResponse[]; shardFiles: File[] }> {
  const [shardFiles] = await bucket.getFiles({ prefix: rawPath });

  if (shardFiles.length === 0) {
    throw new Error(`Vision API wrote no output under ${rawPath}`);
  }

  const shards = shardFiles
    .map((file) => {
      const match = file.name.match(SHARD_NAME_PATTERN);
      return {
        file,
        startPage: match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.startPage - b.startPage);

  // Shards are parsed one at a time so peak memory is about one full shard
  // plus the slimmed accumulator, not every shard's full annotation at once.
  const responses: VisionShardResponse[] = [];
  for (const { file } of shards) {
    const [content] = await file.download();
    const shard = JSON.parse(content.toString('utf-8')) as VisionShardResult;
    for (const response of shard.responses ?? []) {
      responses.push(slimVisionResponse(response));
    }
  }

  return { responses, shardFiles };
}

// How much of a rejected object is read to tell an HTML page from a PDF: the
// doctype or root tag sits at the very start, after at most a BOM and
// whitespace.
const CONTENT_SNIFF_BYTES = 512;

/**
 * Whether a buffer starts the way an HTML document does, ignoring a UTF-8 BOM
 * and leading whitespace.
 * @param content Leading bytes of the object
 * @returns true when the content opens with an HTML doctype or root tag
 */
function startsWithHtml(content: Buffer): boolean {
  const head = content
    .toString('utf-8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * Explain a Vision rejection whose cause is a PDF that is really an HTML page.
 *
 * A download that served an error page under a .pdf name is rejected with the
 * same generic message as any other unreadable PDF, and the fix (re-download
 * the original) is invisible from that message alone. The object is read only
 * on this failure path, and a failed read leaves the message as it was.
 * @param file The rejected object
 * @param contentType Its declared content type
 * @param message Vision's rejection message
 * @returns The message, with a hint appended when the content is an HTML page
 */
async function describeRejectedInput(
  file: File,
  contentType: string,
  message: string
): Promise<string> {
  if (contentType !== 'application/pdf') {
    return message;
  }
  try {
    const [head] = await file.download({
      start: 0,
      end: CONTENT_SNIFF_BYTES - 1,
    });
    if (startsWithHtml(head)) {
      return `${message} (content is an HTML page, not a PDF — the source likely served an error page; re-download the original)`;
    }
  } catch (readError) {
    logger.warn('Could not read the rejected object to describe its content', {
      error: readError,
    });
  }
  return message;
}

export const textVisionProcessor = async (
  storageObjectData: StorageObjectData
): Promise<Result> => {
  let originalFileId = '';
  let originalFileName = '';

  try {
    logger.info('Received Storage object data', { storageObjectData });

    // Parse storage event data using shared utility
    const {
      bucket,
      name: objectName,
      contentType,
    } = parseStorageEvent(storageObjectData);

    // Read the original file's identity before any check that can fail
    // permanently: the failure notification needs it to reach the owner.
    const storage = new Storage();
    const file = storage.bucket(bucket).file(objectName);
    const [metadata] = await file.getMetadata();

    originalFileId = String(metadata.metadata?.originalFileId || '');
    originalFileName = String(metadata.metadata?.originalFileName || '');
    const contentHash = metadata.metadata?.contentHash;

    // Check if file type is supported for text extraction
    if (!contentType || !SUPPORTED_MIME_TYPES.includes(contentType)) {
      logger.info('Skipping text extraction for unsupported file type', {
        contentType,
      });
      throw new PermanentError(
        `Unsupported file type for text extraction: ${contentType}`
      );
    }

    const vision = new ImageAnnotatorClient();

    if (!originalFileId || !originalFileName || !contentHash) {
      throw new PermanentError('Missing required metadata from uploaded file');
    }

    logger.info('Starting Vision API processing', {
      originalFileName,
      objectName,
    });

    // Setup output bucket and path
    const projectId = getProjectId();
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error(
        'ENVIRONMENT environment variable is required but not set'
      );
    }

    const outputBucket = `${projectId}-${environment}-vision-results`;
    const outputPath = `results/${contentHash}/`;

    // Handle text files separately - no need for Vision API
    if (contentType === 'text/plain') {
      // For plain text files, read content and create a simple result structure
      const [fileContent] = await file.download();
      const extractedText = fileContent.toString('utf-8');

      const textResult = {
        responses: [
          {
            fullTextAnnotation: {
              text: extractedText,
              pages: [
                {
                  confidence: 1.0,
                },
              ],
            },
          },
        ],
      };

      // Store the result in the output bucket
      const outputFile = storage
        .bucket(outputBucket)
        .file(`${outputPath}output-1-to-1.json`);
      await outputFile.save(JSON.stringify(textResult, null, 2), {
        metadata: {
          contentType: 'application/json',
          metadata: {
            originalFileId: originalFileId,
            originalFileName: originalFileName,
            originalMimeType: contentType,
            contentHash: contentHash,
            processedAt: new Date().toISOString(),
          },
        },
      });

      return {
        message: `Successfully processed text file ${originalFileName}`,
        objectName: objectName,
        outputBucket: outputBucket,
        outputPath: outputPath,
        operationId: 'text-direct-processing',
      };
    }

    // Single-image formats: annotate synchronously and write the result JSON
    // ourselves, mirroring the text/plain branch, because the async files API
    // rejects them (see VISION_FILE_MIME_TYPES).
    if (VISION_IMAGE_MIME_TYPES.includes(contentType)) {
      const [batchResult] = await vision.batchAnnotateImages({
        requests: [
          {
            image: {
              source: { imageUri: `gs://${bucket}/${objectName}` },
            },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' as const }],
          },
        ],
      });

      const response = batchResult.responses?.[0];
      if (!response) {
        throw new Error('No responses received from Vision API');
      }

      // batchAnnotateImages embeds per-image errors in the response instead
      // of throwing; INVALID_ARGUMENT (3) means the image itself is
      // unreadable, so retrying can never succeed.
      if (response.error) {
        const errorMessage = response.error.message || 'Unknown error';
        if (response.error.code === 3) {
          throw new PermanentError(
            `Vision API rejected input: ${errorMessage}`
          );
        }
        throw new Error(`Vision API image annotation failed: ${errorMessage}`);
      }

      const imageResult = {
        responses: [{ fullTextAnnotation: response.fullTextAnnotation }],
      };

      const outputFile = storage
        .bucket(outputBucket)
        .file(`${outputPath}output-1-to-1.json`);
      await outputFile.save(JSON.stringify(imageResult, null, 2), {
        metadata: {
          contentType: 'application/json',
          metadata: {
            originalFileId: originalFileId,
            originalFileName: originalFileName,
            originalMimeType: contentType,
            contentHash: contentHash,
            processedAt: new Date().toISOString(),
          },
        },
      });

      const imageResultObj = {
        message: `Successfully processed image ${originalFileName} with Vision API`,
        objectName: objectName,
        outputBucket: outputBucket,
        outputPath: outputPath,
        operationId: 'image-sync-annotation',
      };

      logger.info('Vision API image annotation completed', {
        result: imageResultObj,
      });

      return imageResultObj;
    }

    // For PDFs, TIFFs, and GIFs, use Vision API async batch processing.
    // Vision writes its shards under raw/, a prefix the writer ignores; the
    // merged result is what lands under results/ and triggers it.
    const rawPath = `raw/${contentHash}/`;
    const request = {
      requests: [
        {
          inputConfig: {
            gcsSource: {
              uri: `gs://${bucket}/${objectName}`,
            },
            mimeType: contentType,
          },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' as const }],
          outputConfig: {
            gcsDestination: {
              uri: `gs://${outputBucket}/${rawPath}`,
            },
            batchSize: VISION_BATCH_SIZE,
          },
        },
      ],
    };

    // Call Vision API async batch processing
    let operationId: string;
    let responseCount: number;
    try {
      const [operation] = await vision.asyncBatchAnnotateFiles(request);

      logger.info('Vision API operation started', {
        operationName: operation.name,
      });

      // Wait for the operation to complete
      const [result] = await operation.promise();

      operationId = operation.name || 'unknown';
      responseCount = result.responses?.length ?? 0;
    } catch (error) {
      // gRPC INVALID_ARGUMENT (3) means Vision rejected the input itself
      // (e.g. a non-PDF file uploaded under a .pdf name); retrying can never
      // succeed and every retry is a billable Vision call.
      if ((error as { code?: number }).code === 3) {
        const rejection = await describeRejectedInput(
          file,
          contentType,
          error instanceof Error ? error.message : String(error)
        );
        throw new PermanentError(
          `Vision API rejected input: ${rejection}`,
          error
        );
      }
      throw error;
    }

    if (responseCount === 0) {
      throw new Error('No responses received from Vision API');
    }

    const resultsBucket = storage.bucket(outputBucket);
    const { responses, shardFiles } = await mergeVisionShards(
      resultsBucket,
      rawPath
    );

    const mergedResult = { responses };

    await resultsBucket
      .file(`${outputPath}output-1-to-1.json`)
      .save(JSON.stringify(mergedResult), {
        metadata: {
          contentType: 'application/json',
          metadata: {
            originalFileId: originalFileId,
            originalFileName: originalFileName,
            originalMimeType: contentType,
            contentHash: contentHash,
            processedAt: new Date().toISOString(),
          },
        },
      });

    logger.info('Merged Vision API output shards', {
      originalFileName,
      shardCount: shardFiles.length,
      pageCount: responses.length,
    });

    // The merged object is already written, so a leftover shard costs only
    // storage; failing here would retry the whole function and bill another
    // Vision run.
    try {
      await Promise.all(shardFiles.map((file) => file.delete()));
    } catch (deleteError) {
      logger.warn('Failed to delete raw Vision API output shards', {
        rawPath,
        error: deleteError,
      });
    }

    const result_obj = {
      message: `Successfully processed ${originalFileName} with Vision API`,
      objectName: objectName,
      outputBucket: outputBucket,
      outputPath: outputPath,
      operationId: operationId,
    };

    logger.info('Vision API processing completed', { result: result_obj });

    return result_obj;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'textVisionProcessor');

    logger.error('Vision API processing error', { error: errorResponse });

    // Permanent failures: ACK (do not retry) to avoid repeated billable calls.
    if (isPermanentError(error)) {
      logger.warn('Skipping message (permanent failure, not retrying)', {
        error: errorResponse.error,
      });

      const notificationTopicName = process.env.NOTIFICATION_TOPIC;
      if (notificationTopicName) {
        try {
          const pubsub = new PubSub();
          await pubsub.topic(notificationTopicName).publishMessage({
            json: {
              fileId: originalFileId,
              fileName: originalFileName,
              stageName: 'text-vision-processor',
              errorMessage: errorResponse.error,
            },
            attributes: {
              operation: 'failure-notification',
              fileId: originalFileId,
            },
          });
        } catch (notifyError) {
          logger.warn('Failed to publish failure notification', {
            error: notifyError,
          });
        }
      }

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        objectName: '',
        outputBucket: '',
        outputPath: '',
        operationId: 'skipped',
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`Vision API processing failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};
