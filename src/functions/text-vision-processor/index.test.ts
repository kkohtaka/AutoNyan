import { textVisionProcessor } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';

// Mock the Google Cloud clients
jest.mock('@google-cloud/vision');
jest.mock('@google-cloud/storage');

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

describe('textVisionProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
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
    expect(result.outputBucket).toBe('test-project-vision-results');
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
              uri: 'gs://test-project-vision-results/results/abc123/',
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

  it('should reject unsupported file types', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/zip',
    });

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'Unsupported file type for text extraction: application/zip'
    );
  });

  it('should require PROJECT_ID environment variable', async () => {
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

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'PROJECT_ID environment variable is required'
    );
  });

  it('should require original file metadata', async () => {
    const cloudEvent = createCloudEvent({
      contentType: 'application/pdf',
    });

    const mockMetadata = {
      metadata: {},
    };

    mockStorage.bucket().file().getMetadata.mockResolvedValue([mockMetadata]);

    await expect(textVisionProcessor(cloudEvent.data!)).rejects.toThrow(
      'Missing required metadata from uploaded file'
    );
  });
});
