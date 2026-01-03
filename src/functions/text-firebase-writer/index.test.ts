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

  it('should process Vision API results and store to Firestore', async () => {
    const cloudEvent = createCloudEvent({});

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        originalMimeType: 'application/pdf',
        contentHash: 'abc123',
        processedAt: '2023-01-01T00:00:00Z',
      },
    };

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

    const originalFileMetadata = {
      size: '1024',
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValueOnce([mockMetadata]) // Vision results metadata
      .mockResolvedValueOnce([originalFileMetadata]); // Original file metadata

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
      extractedAt: '2023-01-01T00:00:00Z',
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

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        originalMimeType: 'application/pdf',
        contentHash: 'abc123',
        processedAt: '2023-01-01T00:00:00Z',
      },
    };

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
      .getMetadata.mockResolvedValueOnce([mockMetadata])
      .mockResolvedValueOnce([{ size: '1024' }]);

    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    const result = await textFirebaseWriter(cloudEvent.data!);

    expect(result.pages).toBe(2); // Only non-empty pages counted
    expect(result.confidence).toBe(0.915); // Average of 0.95 and 0.88
    expect(result.textLength).toBe('Valid textMore valid text\n'.length);
  });

  it('should reject non-JSON files', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'text/plain',
    });

    await expect(textFirebaseWriter(cloudEvent.data!)).rejects.toThrow(
      'Unsupported file type: text/plain'
    );
  });

  it('should require PROJECT_ID environment variable', async () => {
    delete process.env.PROJECT_ID;

    const cloudEvent = createCloudEvent({});

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        originalMimeType: 'application/pdf',
        contentHash: 'abc123',
      },
    };

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

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    await expect(textFirebaseWriter(cloudEvent.data!)).rejects.toThrow(
      'PROJECT_ID environment variable is required'
    );
  });

  it('should require original file metadata', async () => {
    const cloudEvent = createCloudEvent({});

    const mockMetadata = {
      metadata: {},
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);

    await expect(textFirebaseWriter(cloudEvent.data!)).rejects.toThrow(
      'Missing required metadata from Vision API result file'
    );
  });

  it('should handle missing Vision API responses', async () => {
    const cloudEvent = createCloudEvent({});

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        originalMimeType: 'application/pdf',
        contentHash: 'abc123',
      },
    };

    const visionResult = {
      responses: [],
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);
    mockStorage
      .bucket()
      .file()
      .download.mockResolvedValue([Buffer.from(JSON.stringify(visionResult))]);

    await expect(textFirebaseWriter(cloudEvent.data!)).rejects.toThrow(
      'No responses found in Vision API result'
    );
  });

  it('should skip classification trigger when FILE_CLASSIFIER_TOPIC is not set', async () => {
    // Unset the environment variable
    delete process.env.FILE_CLASSIFIER_TOPIC;

    const cloudEvent = createCloudEvent({});

    const mockMetadata = {
      metadata: {
        originalFileId: 'file123',
        originalFileName: 'test.pdf',
        originalMimeType: 'application/pdf',
        contentHash: 'abc123',
        processedAt: '2023-01-01T00:00:00Z',
      },
    };

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

    const originalFileMetadata = {
      size: '1024',
    };

    mockStorage
      .bucket()
      .file()
      .getMetadata.mockResolvedValueOnce([mockMetadata])
      .mockResolvedValueOnce([originalFileMetadata]);

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
