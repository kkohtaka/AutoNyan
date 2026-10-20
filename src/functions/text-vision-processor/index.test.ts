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
        shard('raw/abc123/output-1-to-20.json', [{ text: 'first' }]),
        shard('raw/abc123/output-101-to-120.json', [{ text: 'third' }]),
        shard('raw/abc123/output-21-to-40.json', [{ text: 'second' }]),
      ],
    ]);

    await textVisionProcessor(cloudEvent.data!);

    const [savedContent] = mockStorage.bucket().file().save.mock.calls[0];
    expect(JSON.parse(savedContent).responses).toEqual([
      { text: 'first' },
      { text: 'second' },
      { text: 'third' },
    ]);
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

  it('should ACK (skip) unsupported file types without retrying', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/zip',
    });

    const result = await textVisionProcessor(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.operationId).toBe('skipped');
    expect(result.message).toContain(
      'Unsupported file type for text extraction: application/zip'
    );
    expect(mockVision.asyncBatchAnnotateFiles).not.toHaveBeenCalled();
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
