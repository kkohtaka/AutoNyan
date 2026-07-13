import { textFirebaseWriter } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';

// Mock the Google Cloud clients
jest.mock('@google-cloud/firestore');
jest.mock('@google-cloud/storage');
jest.mock('@google-cloud/pubsub');

const mockFirestore = {
  collection: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ id: 'doc123' }),
  }),
};

const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      getMetadata: jest.fn(),
      download: jest.fn(),
    }),
  }),
};

const mockPublishMessage = jest.fn().mockResolvedValue('message-id-1');
const mockTopic = jest.fn().mockReturnValue({
  publishMessage: mockPublishMessage,
});
const mockPubSubInstance = {
  topic: mockTopic,
};

// Mock the constructors
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/firestore').Firestore = jest.fn(() => mockFirestore);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/storage').Storage = jest.fn(() => mockStorage);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/pubsub').PubSub = jest.fn(() => mockPubSubInstance);

describe('textFirebaseWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
    process.env.ENVIRONMENT = 'staging';
    process.env.FILE_CLASSIFIER_TOPIC = 'file-classification-trigger';
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.ENVIRONMENT;
    delete process.env.FILE_CLASSIFIER_TOPIC;
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
      bucket: 'test-vision-results',
      name: 'results/abc123/output-1-to-1.json',
      contentType: 'application/json',
      ...data,
    } as StorageObjectData,
  });

  // Metadata of the original document object in document storage; Vision API
  // result objects themselves carry no custom metadata.
  const originalDocMetadata = {
    metadata: {
      originalFileId: 'file123',
      originalFileName: 'test.pdf',
      originalMimeType: 'application/pdf',
    },
    size: '1024',
  };

  it('should process Vision API results and store to Firestore', async () => {
    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          fullTextAnnotation: {
            text: 'Page 1 text',
            pages: [{ confidence: 0.95 }],
          },
        },
        {
          fullTextAnnotation: {
            text: 'Page 2 text',
            pages: [{ confidence: 0.9 }],
          },
        },
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);

    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.message).toContain(
      'Successfully stored extracted text from test.pdf'
    );
    expect(result.firestoreDocId).toBe('doc123');
    expect(result.textLength).toBe('Page 1 textPage 2 text\n'.length);
    expect(result.confidence).toBe(0.925); // Average of 0.95 and 0.90
    expect(result.pages).toBe(2);
    expect(result.classificationTriggered).toBe(true);

    expect(mockStorage.bucket).toHaveBeenCalledWith(
      'test-project-staging-document-storage'
    );
    expect(mockFirestore.collection).toHaveBeenCalledWith('extracted_texts');
    expect(mockFirestore.collection().add).toHaveBeenCalledWith({
      fileId: 'file123',
      objectName: 'documents/abc123',
      extractedText: 'Page 1 textPage 2 text\n',
      confidence: 0.925,
      pages: [
        { pageNumber: 1, text: 'Page 1 text', confidence: 0.95 },
        { pageNumber: 2, text: 'Page 2 text', confidence: 0.9 },
      ],
      extractedAt: expect.any(String),
      mimeType: 'application/pdf',
      fileName: 'test.pdf',
      fileSize: 1024,
      contentHash: 'abc123',
      visionResultPath:
        'gs://test-vision-results/results/abc123/output-1-to-1.json',
    });

    // Verify PubSub was called
    expect(mockPublishMessage).toHaveBeenCalled();
    expect(mockTopic).toHaveBeenCalledWith('file-classification-trigger');
  });

  it('should handle empty text pages gracefully', async () => {
    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          fullTextAnnotation: {
            text: 'Valid text',
            pages: [{ confidence: 0.95 }],
          },
        },
        {
          fullTextAnnotation: {
            text: '   ', // Only whitespace
            pages: [{ confidence: 0.9 }],
          },
        },
        {
          fullTextAnnotation: {
            text: 'More valid text',
            pages: [{ confidence: 0.88 }],
          },
        },
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);

    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.pages).toBe(2); // Only non-empty pages counted
    expect(result.confidence).toBe(0.915); // Average of 0.95 and 0.88
    expect(result.textLength).toBe('Valid textMore valid text\n'.length);
  });

  it('should ACK (skip) non-JSON files without retrying', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'text/plain',
    });

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('Unsupported file type: text/plain');
    expect(mockFirestore.collection().add).not.toHaveBeenCalled();
  });

  it('should ACK (skip) when PROJECT_ID environment variable is missing', async () => {
    delete process.env.PROJECT_ID;

    const cloudEvent = createCloudEvent({});

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'PROJECT_ID environment variable is required'
    );
  });

  it('should ACK (skip) when the result object path is unexpected', async () => {
    const cloudEvent = createCloudEvent({
      name: 'unexpected/output.json',
    });

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Unexpected Vision API result object path'
    );
    expect(mockFirestore.collection().add).not.toHaveBeenCalled();
  });

  it('should publish a failure notification on permanent failure when NOTIFICATION_TOPIC is set', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const cloudEvent = createCloudEvent({});
    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);
    // Empty responses trigger a permanent failure after metadata is resolved
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([
        Buffer.from(JSON.stringify({ responses: [] })),
      ]);

    await textFirebaseWriter(cloudEvent.data!);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  it('should ACK (skip) when original document metadata is missing', async () => {
    const cloudEvent = createCloudEvent({});

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([{ metadata: {} }]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Missing required metadata on original document object'
    );
  });

  it('should ACK (skip) when Vision API responses are missing', async () => {
    const cloudEvent = createCloudEvent({});

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([
        Buffer.from(JSON.stringify({ responses: [] })),
      ]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('No responses found in Vision API result');
  });

  it('should ACK (skip) and notify when the result contains only embedded errors', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          error: {
            code: 3,
            message: 'Unsupported input file format.',
          },
        },
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Vision API result contains only errors: Unsupported input file format.'
    );
    expect(mockFirestore.collection().add).not.toHaveBeenCalled();
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  it('should ACK (skip) when no page yields any text', async () => {
    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          fullTextAnnotation: {
            text: '   ',
            pages: [{ confidence: 0.1 }],
          },
        },
        {},
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Vision API result contains no extracted text'
    );
    expect(mockFirestore.collection().add).not.toHaveBeenCalled();
  });

  it('should store partial results when some pages have text and others errors', async () => {
    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          fullTextAnnotation: {
            text: 'Readable page',
            pages: [{ confidence: 0.9 }],
          },
        },
        {
          error: {
            code: 3,
            message: 'Bad image data.',
          },
        },
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.skipped).toBeUndefined();
    expect(result.textLength).toBe('Readable page'.length);
    expect(result.pages).toBe(1);
    expect(mockFirestore.collection().add).toHaveBeenCalled();
  });

  it('should throw (retry) on transient storage failures', async () => {
    const cloudEvent = createCloudEvent({});

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockRejectedValue(
        new Error('Storage temporarily unavailable')
      );

    await expect(textFirebaseWriter(cloudEvent.data!)).rejects.toThrow(
      'Firebase storage failed: Storage temporarily unavailable'
    );
  });

  it('should skip classification trigger when FILE_CLASSIFIER_TOPIC is not set', async () => {
    // Unset the environment variable
    delete process.env.FILE_CLASSIFIER_TOPIC;

    const cloudEvent = createCloudEvent({});

    const visionResult = {
      responses: [
        {
          fullTextAnnotation: {
            text: 'Test text',
            pages: [{ confidence: 0.95 }],
          },
        },
      ],
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValue([originalDocMetadata]);

    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.message).toContain(
      'Successfully stored extracted text from test.pdf'
    );
    expect(result.firestoreDocId).toBe('doc123');
    expect(result.classificationTriggered).toBe(false); // Not triggered

    // Verify PubSub was not called
    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockTopic).not.toHaveBeenCalled();
  });
});
