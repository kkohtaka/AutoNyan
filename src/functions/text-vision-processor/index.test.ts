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
};

const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      getMetadata: jest.fn(),
      download: jest.fn(),
      save: jest.fn(),
    }),
  }),
};

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

  it('should process PDF files with Vision API', async () => {
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

    const mockOperation = {
      name: 'operation123',
      promise: jest.fn().mockResolvedValue([
        {
          responses: [{ fullTextAnnotation: { text: 'extracted text' } }],
        },
      ]),
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockVision.asyncBatchAnnotateFiles.mockResolvedValue([mockOperation]);

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
              uri: 'gs://test-project-staging-vision-results/results/abc123/',
            },
            batchSize: 20,
          },
        },
      ],
    });
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
