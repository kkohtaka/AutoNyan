import { textVisionProcessor } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';

// Mock the Google Cloud clients
jest.mock('@google-cloud/vision');
jest.mock('@google-cloud/storage');
jest.mock('@google-cloud/pubsub');

const mockPublishMessage = jest.fn();
const mockVision = {
  asyncBatchAnnotateFiles: jest.fn(),
  batchAnnotateImages: jest.fn(),
};

const mockGetFiles = jest.fn();
const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      getMetadata: jest.fn(),
      download: jest.fn(),
      save: jest.fn(),
    }),
    getFiles: mockGetFiles,
  }),
};

// A Vision output shard as the results bucket lists it
const shard = (name: string, responses: unknown[]) => ({
  name,
  download: jest
    .fn()
    .mockResolvedValue([Buffer.from(JSON.stringify({ responses }))]),
  delete: jest.fn().mockResolvedValue(undefined),
});

const pdfMetadata = {
  metadata: {
    originalFileId: 'file123',
    originalFileName: 'test.pdf',
    contentHash: 'abc123',
  },
};

const pdfOperation = () => ({
  name: 'operation123',
  promise: jest.fn().mockResolvedValue([
    {
      responses: [
        {
          outputConfig: {
            gcsDestination: {
              uri: 'gs://test-project-staging-vision-results/raw/abc123/',
            },
          },
        },
      ],
    },
  ]),
});

// Mock the constructors
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/vision').ImageAnnotatorClient = jest.fn(
  () => mockVision
);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/storage').Storage = jest.fn(() => mockStorage);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/pubsub').PubSub = jest.fn(() => ({
  topic: jest.fn().mockReturnValue({ publishMessage: mockPublishMessage }),
}));

describe('textVisionProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
    process.env.ENVIRONMENT = 'staging';
    mockPublishMessage.mockResolvedValue('message-id');
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.ENVIRONMENT;
    delete process.env.NOTIFICATION_TOPIC;
  });

  const createCloudEvent = (
    data: Partial<StorageObjectData>
  ): CloudEvent<StorageObjectData> => ({
    specversion: '1.0',
    id: 'test-id',
    source: 'test-source',
    type: 'google.cloud.storage.object.v1.finalized',
    time: '2023-01-01T00:00:00Z',
    data: {
      bucket: 'test-bucket',
      name: 'documents/test-file.pdf',
      contentType: 'application/pdf',
      ...data,
    } as StorageObjectData,
  });

  it('should process PDF files with Vision API and merge the output shards', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const shards = [
      shard('raw/abc123/output-1-to-20.json', [
        { fullTextAnnotation: { text: 'page 1' } },
      ]),
      shard('raw/abc123/output-21-to-40.json', [
        { fullTextAnnotation: { text: 'page 21' } },
      ]),
    ];

    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([shards]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.message).toContain(
      'Successfully processed test.pdf with Vision API'
    );
    expect(result.outputBucket).toBe('test-project-staging-vision-results');
    expect(result.outputPath).toBe('results/abc123/');
    expect(mockVision.asyncBatchAnnotateFiles).toHaveBeenCalledWith({
      requests: [
        {
          inputConfig: {
            gcsSource: { uri: 'gs://test-bucket/documents/test-file.pdf' },
            mimeType: 'application/pdf',
          },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          outputConfig: {
            gcsDestination: {
              uri: 'gs://test-project-staging-vision-results/raw/abc123/',
            },
            batchSize: 20,
          },
        },
      ],
    });

    expect(mockGetFiles).toHaveBeenCalledWith({ prefix: 'raw/abc123/' });
    expect(mockStorage.bucket().file).toHaveBeenCalledWith(
      'results/abc123/output-1-to-1.json'
    );

    const [savedContent, saveOptions] = mockStorage.bucket().file().save.mock
      .calls[0];
    expect(JSON.parse(savedContent)).toEqual({
      responses: [
        { fullTextAnnotation: { text: 'page 1' } },
        { fullTextAnnotation: { text: 'page 21' } },
      ],
    });
    expect(saveOptions.metadata.metadata).toMatchObject({
      originalFileId: 'file123',
      originalFileName: 'test.pdf',
      originalMimeType: 'application/pdf',
      contentHash: 'abc123',
    });

    for (const shardFile of shards) {
      expect(shardFile.delete).toHaveBeenCalled();
    }
  });

  it('should merge shards in page order, not in listing order', async () => {
    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });

    // Lexicographic listing order: 1-to-20, 101-to-120, 21-to-40
    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([
      [
        shard('raw/abc123/output-1-to-20.json', [
          { fullTextAnnotation: { text: 'first' } },
        ]),
        shard('raw/abc123/output-101-to-120.json', [
          { fullTextAnnotation: { text: 'third' } },
        ]),
        shard('raw/abc123/output-21-to-40.json', [
          { fullTextAnnotation: { text: 'second' } },
        ]),
      ],
    ]);

    await textVisionProcessor(cloudEvent.data!);

    const [savedContent] = mockStorage.bucket().file().save.mock.calls[0];
    expect(JSON.parse(savedContent).responses).toEqual([
      { fullTextAnnotation: { text: 'first' } },
      { fullTextAnnotation: { text: 'second' } },
      { fullTextAnnotation: { text: 'third' } },
    ]);
  });

  it('should keep only the text, first-page confidence and error of each response', async () => {
    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });

    const fullAnnotation = (text: string, confidence: number) => ({
      fullTextAnnotation: {
        text,
        pages: [
          {
            confidence,
            width: 612,
            height: 792,
            blocks: [
              {
                blockType: 'TEXT',
                boundingBox: { vertices: [{ x: 1, y: 1 }] },
                paragraphs: [
                  {
                    words: [
                      {
                        symbols: [{ text: text[0], confidence }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { confidence: 0.1 },
        ],
      },
      context: { pageNumber: 1, uri: 'gs://test-bucket/documents/test.pdf' },
    });

    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([
      [
        shard('raw/abc123/output-1-to-20.json', [
          fullAnnotation('alpha', 0.9),
          fullAnnotation('beta', 0.8),
        ]),
        shard('raw/abc123/output-21-to-40.json', [
          {
            error: { code: 3, message: 'Bad page.' },
            context: { pageNumber: 21 },
          },
          { fullTextAnnotation: { text: 'gamma' } },
        ]),
      ],
    ]);

    await textVisionProcessor(cloudEvent.data!);

    const [savedContent] = mockStorage.bucket().file().save.mock.calls[0];
    expect(JSON.parse(savedContent)).toEqual({
      responses: [
        { fullTextAnnotation: { text: 'alpha', pages: [{ confidence: 0.9 }] } },
        { fullTextAnnotation: { text: 'beta', pages: [{ confidence: 0.8 }] } },
        { error: { code: 3, message: 'Bad page.' } },
        { fullTextAnnotation: { text: 'gamma' } },
      ],
    });
  });

  it('should merge every page of every shard in page order', async () => {
    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });

    const pages = (first: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        fullTextAnnotation: { text: `page ${first + i}` },
      }));

    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([
      [
        shard('raw/abc123/output-1-to-20.json', pages(1, 20)),
        shard('raw/abc123/output-41-to-45.json', pages(41, 5)),
        shard('raw/abc123/output-21-to-40.json', pages(21, 20)),
      ],
    ]);

    await textVisionProcessor(cloudEvent.data!);

    const [savedContent] = mockStorage.bucket().file().save.mock.calls[0];
    const merged = JSON.parse(savedContent).responses as Array<{
      fullTextAnnotation: { text: string };
    }>;
    expect(merged).toHaveLength(45);
    expect(merged.map((r) => r.fullTextAnnotation.text)).toEqual(
      Array.from({ length: 45 }, (_, i) => `page ${i + 1}`)
    );
  });

  it('should throw (retry) when Vision reports success but wrote no shards', async () => {
    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });

    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([[]]);

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'Vision API wrote no output under raw/abc123/'
    );
    expect(mockStorage.bucket().file().save).not.toHaveBeenCalled();
  });

  it('should succeed even when deleting the raw shards fails', async () => {
    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });

    const failingShard = shard('raw/abc123/output-1-to-20.json', [
      { fullTextAnnotation: { text: 'page 1' } },
    ]);
    failingShard.delete.mockRejectedValue(new Error('delete failed'));

    mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([pdfOperation()]);
    mockGetFiles.mockResolvedValue([[failingShard]]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBeUndefined();
    expect(mockStorage.bucket().file().save).toHaveBeenCalled();
  });

  it('should process image files with synchronous Vision annotation', async () => {
    const cloudEvent = createCloudEvent({
      name: 'documents/test-image.png',
      contentType: 'image/png',
    });

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.png',
        contentHash: 'abc123',
      },
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockVision.batchAnnotateImages.mockResolvedValue([
      {
        responses: [
          {
            fullTextAnnotation: {
              text: 'image text',
              pages: [{ confidence: 0.9 }],
            },
          },
        ],
      },
    ]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.message).toContain(
      'Successfully processed image test.png with Vision API'
    );
    expect(result.operationId).toBe('image-sync-annotation');
    expect(result.outputBucket).toBe('test-project-staging-vision-results');
    expect(result.outputPath).toBe('results/abc123/');
    expect(mockVision.batchAnnotateImages).toHaveBeenCalledWith({
      requests: [
        {
          image: {
            source: { imageUri: 'gs://test-bucket/documents/test-image.png' },
          },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    });
    expect(mockVision.asyncBatchAnnotateFiles).not.toHaveBeenCalled();
    expect(mockStorage.bucket().file().save).toHaveBeenCalledWith(
      expect.stringContaining('"text": "image text"'),
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentType: 'application/json',
        }),
      })
    );
  });

  it('should ACK (skip) when Vision API rejects an image input', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const cloudEvent = createCloudEvent({
      name: 'documents/test-image.png',
      contentType: 'image/png',
    });

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([
        {
          metadata: {
            originalFileId: 'file123',
            originalFileName: 'test.png',
            contentHash: 'abc123',
          },
        },
      ]);
    // batchAnnotateImages embeds per-image errors instead of throwing
    mockVision.batchAnnotateImages.mockResolvedValue([
      {
        responses: [{ error: { code: 3, message: 'Bad image data.' } }],
      },
    ]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Vision API rejected input: Bad image data.'
    );
    expect(mockStorage.bucket().file().save).not.toHaveBeenCalled();
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  it('should throw (retry) on transient image annotation errors', async () => {
    const cloudEvent = createCloudEvent({
      name: 'documents/test-image.png',
      contentType: 'image/png',
    });

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([
        {
          metadata: {
            originalFileId: 'file123',
            originalFileName: 'test.png',
            contentHash: 'abc123',
          },
        },
      ]);
    // UNAVAILABLE (14) embedded in the response is retryable
    mockVision.batchAnnotateImages.mockResolvedValue([
      {
        responses: [{ error: { code: 14, message: 'Service unavailable.' } }],
      },
    ]);

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'Vision API image annotation failed: Service unavailable.'
    );
    expect(mockStorage.bucket().file().save).not.toHaveBeenCalled();
  });

  it('should process text files directly without Vision API', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'text/plain',
    });

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.txt',
        contentHash: 'abc123',
      },
    };

    const fileContent = Buffer.from('Hello world');

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockStorage.bucket().file().download.mockResolvedValue([fileContent]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.message).toContain(
      'Successfully processed text file test.txt'
    );
    expect(result.operationId).toBe('text-direct-processing');
    expect(mockVision.asyncBatchAnnotateFiles).not.toHaveBeenCalled();
    expect(mockStorage.bucket().file().save).toHaveBeenCalledWith(
      expect.stringContaining('"text": "Hello world"'),
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentType: 'application/json',
        }),
      })
    );
  });

  it('should ACK (skip) unsupported file types and notify the file owner', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const cloudEvent = createCloudEvent({
      contentType: 'application/zip',
    });
    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([
        {
          metadata: {
            originalFileId: 'file123',
            originalFileName: 'test.zip',
            contentHash: 'abc123',
          },
        },
      ]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.operationId).toBe('skipped');
    expect(result.message).toContain(
      'Unsupported file type for text extraction: application/zip'
    );
    expect(mockVision.asyncBatchAnnotateFiles).not.toHaveBeenCalled();
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          fileId: 'file123',
          fileName: 'test.zip',
        }),
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  it('should ACK (skip) when PROJECT_ID environment variable is missing', async () => {
    delete process.env.PROJECT_ID;

    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        contentHash: 'abc123',
      },
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'PROJECT_ID environment variable is required'
    );
  });

  it('should ACK (skip) when original file metadata is missing', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const mockMetadata = {
      metadata: {},
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Missing required metadata from uploaded file'
    );
  });

  it('should publish a failure notification on permanent failure when NOTIFICATION_TOPIC is set', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';
    delete process.env.PROJECT_ID; // triggers a permanent failure

    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });
    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([
        {
          metadata: {
            originalFileId: 'file123',
            originalFileName: 'test.pdf',
            contentHash: 'abc123',
          },
        },
      ]);

    await textVisionProcessor(cloudEvent.data!);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  it('should not fail when notification publishing throws', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';
    delete process.env.PROJECT_ID;
    mockPublishMessage.mockRejectedValueOnce(new Error('publish failed'));

    const cloudEvent = createCloudEvent({ contentType: 'application/pdf' });
    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([
        {
          metadata: {
            originalFileId: 'file123',
            originalFileName: 'test.pdf',
            contentHash: 'abc123',
          },
        },
      ]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
  });

  it('should ACK (skip) when Vision API rejects the input format', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        contentHash: 'abc123',
      },
    };

    // gRPC INVALID_ARGUMENT, as returned for e.g. an HTML file named .pdf
    const invalidArgumentError = Object.assign(
      new Error('Unsupported input file format.'),
      { code: 3 }
    );

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([
      {
        name: 'operation123',
        promise: jest.fn().mockRejectedValue(invalidArgumentError),
      },
    ]);

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Vision API rejected input: Unsupported input file format.'
    );
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  describe('when Vision rejects a PDF-typed object', () => {
    const invalidArgumentError = () =>
      Object.assign(new Error('Unsupported input file format.'), { code: 3 });

    beforeEach(() => {
      process.env.NOTIFICATION_TOPIC = 'notification-trigger';
      mockStorage.bucket().file().getMetadata.mockResolvedValue([pdfMetadata]);
      mockVision.asyncBatchAnnotateFiles.mockResolvedValue([
        {
          name: 'operation123',
          promise: jest.fn().mockRejectedValue(invalidArgumentError()),
        },
      ]);
    });

    it('should say so when the content is an HTML page', async () => {
      mockStorage
        .bucket()
        .file()
        .download.mockResolvedValue([
          Buffer.from('\uFEFF\n  <!DOCTYPE html><html><body>404</body></html>'),
        ]);

      const result = await textVisionProcessor(
        createCloudEvent({ contentType: 'application/pdf' }).data!
      );

      expect(result.skipped).toBe(true);
      expect(result.message).toContain(
        'Vision API rejected input: Unsupported input file format. (content is an HTML page, not a PDF'
      );
      expect(mockStorage.bucket().file().download).toHaveBeenCalledWith({
        start: 0,
        end: 511,
      });
      expect(mockPublishMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          json: expect.objectContaining({
            errorMessage: expect.stringContaining('re-download the original'),
          }),
        })
      );
    });

    it('should recognise a bare <html> root tag too', async () => {
      mockStorage
        .bucket()
        .file()
        .download.mockResolvedValue([Buffer.from('<HTML lang="en">')]);

      const result = await textVisionProcessor(
        createCloudEvent({ contentType: 'application/pdf' }).data!
      );

      expect(result.message).toContain('content is an HTML page');
    });

    it('should keep the original message when the content is not HTML', async () => {
      mockStorage
        .bucket()
        .file()
        .download.mockResolvedValue([Buffer.from('%PDF-1.7 garbage')]);

      const result = await textVisionProcessor(
        createCloudEvent({ contentType: 'application/pdf' }).data!
      );

      expect(result.skipped).toBe(true);
      expect(result.message).toBe(
        'Skipped (permanent failure): Vision API rejected input: Unsupported input file format.'
      );
    });

    it('should keep the original message when the content cannot be read', async () => {
      mockStorage
        .bucket()
        .file()
        .download.mockRejectedValue(new Error('read failed'));

      const result = await textVisionProcessor(
        createCloudEvent({ contentType: 'application/pdf' }).data!
      );

      expect(result.skipped).toBe(true);
      expect(result.message).toBe(
        'Skipped (permanent failure): Vision API rejected input: Unsupported input file format.'
      );
    });

    it('should not read the object when the declared type is not PDF', async () => {
      const result = await textVisionProcessor(
        createCloudEvent({ contentType: 'image/tiff' }).data!
      );

      expect(result.skipped).toBe(true);
      expect(mockStorage.bucket().file().download).not.toHaveBeenCalled();
    });
  });

  it('should throw (retry) on transient Vision API failures', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        contentHash: 'abc123',
      },
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockRejectedValue(
      new Error('Vision API temporarily unavailable')
    );

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'Vision API processing failed: Vision API temporarily unavailable'
    );
  });
});
