import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { docProcessor } from './index';

// Mock dependencies
const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      createWriteStream: jest.fn().mockReturnValue({
        write: jest.fn().mockImplementation((buffer, callback) => {
          process.nextTick(() => callback(null));
        }),
        end: jest.fn(),
      }),
      getMetadata: jest.fn().mockResolvedValue([{ size: '1024' }]),
      exists: jest.fn().mockResolvedValue([false]),
    }),
  }),
};

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => mockStorage),
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        get: jest.fn(),
      },
    }),
  },
}));

describe('docProcessor', () => {
  let mockDrive: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
    process.env.ENVIRONMENT = 'staging';
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const { google } = require('googleapis');
    mockDrive = google.drive();
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.ENVIRONMENT;
  });

  test('should process CloudEvent and copy file to Cloud Storage', async () => {
    // Mock Drive API responses
    mockDrive.files.get
      .mockResolvedValueOnce({
        data: {
          id: 'file123',
          name: 'test-document.pdf',
          mimeType: 'application/pdf',
          size: '1024',
          modifiedTime: '2023-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          on: jest.fn().mockImplementation((event, callback) => {
            if (event === 'data') {
              // Call the callback immediately with test data
              process.nextTick(() => {
                callback(Buffer.from('test file content'));
              });
            } else if (event === 'end') {
              // Call the callback immediately to end the stream
              process.nextTick(() => {
                callback();
              });
            } else if (event === 'error') {
              // Store error callback but don't call it in success case
            }
            // Return the same object for chaining
            return {
              on: jest.fn().mockImplementation((event, callback) => {
                if (event === 'end') {
                  // Call the callback immediately to end the stream
                  process.nextTick(() => {
                    callback();
                  });
                } else if (event === 'error') {
                  // Store error callback but don't call it in success case
                }
                return { on: jest.fn().mockReturnThis() };
              }),
            };
          }),
        },
      });

    // Create mock CloudEvent
    const messageData = {
      fileId: 'file123',
    };

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify(messageData)).toString('base64') as any,
    };

    const result = await docProcessor(cloudEvent);

    expect(result.message).toContain(
      'Successfully copied file test-document.pdf'
    );
    expect(result.fileId).toBe('file123');
    expect(result.fileName).toBe('test-document.pdf');
    expect(result.bucketName).toBe('test-project-staging-document-storage');
    expect(result.contentType).toBe('application/pdf');
    expect(result.size).toBe(1024);
    expect(result.objectName).toMatch(/^documents\/[a-f0-9]{64}$/); // SHA256 hash

    // Verify Drive API calls
    expect(mockDrive.files.get).toHaveBeenCalledWith({
      fileId: 'file123',
      fields: 'id,name,mimeType,size,modifiedTime',
      supportsAllDrives: true,
    });

    expect(mockDrive.files.get).toHaveBeenCalledWith(
      {
        fileId: 'file123',
        alt: 'media',
        supportsAllDrives: true,
      },
      {
        responseType: 'stream',
      }
    );
  }, 20000);

  test('should ACK (skip) when no fileId is provided', async () => {
    const messageData = {};

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify(messageData)).toString('base64') as any,
    };

    const result = await docProcessor(cloudEvent);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('Missing required fields: fileId');
    expect(mockDrive.files.get).not.toHaveBeenCalled();
  });

  test('should ACK (skip) when no message data is provided', async () => {
    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: undefined,
    };

    const result = await docProcessor(cloudEvent);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('CloudEvent data is required');
  });

  test('should handle Drive API errors gracefully', async () => {
    const messageData = {
      fileId: 'file123',
    };

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify(messageData)).toString('base64') as any,
    };

    mockDrive.files.get.mockRejectedValueOnce(new Error('Drive API error'));

    await expect(docProcessor(cloudEvent)).rejects.toThrow(
      'Document scan preparation failed: Drive API error'
    );
  });

  test('should ACK (skip) when Drive returns invalid file data', async () => {
    // Drive returns a file with neither id nor name -> permanent failure
    mockDrive.files.get.mockResolvedValueOnce({
      data: {
        mimeType: 'application/pdf',
      },
    });

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify({ fileId: 'file123' })).toString(
        'base64'
      ) as any,
    };

    const result = await docProcessor(cloudEvent);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain(
      'Invalid file data received for fileId: file123'
    );
  });

  test('should throw (retry) when ENVIRONMENT is not set', async () => {
    delete process.env.ENVIRONMENT;

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify({ fileId: 'file123' })).toString(
        'base64'
      ) as any,
    };

    await expect(docProcessor(cloudEvent)).rejects.toThrow(
      'ENVIRONMENT environment variable is required'
    );
  });

  test('should skip upload when object already exists in Cloud Storage', async () => {
    // Self-referencing stream mock so chained .on('data').on('end') both fire
    const mockStream: any = {
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'data') {
          process.nextTick(() => callback(Buffer.from('test file content')));
        } else if (event === 'end') {
          process.nextTick(() => callback());
        }
        return mockStream;
      }),
    };

    mockDrive.files.get
      .mockResolvedValueOnce({
        data: {
          id: 'file123',
          name: 'test-document.pdf',
          mimeType: 'application/pdf',
          size: '1024',
          modifiedTime: '2023-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: mockStream,
      });

    // Object already exists in the bucket
    mockStorage.bucket().file().exists.mockResolvedValueOnce([true]);

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify({ fileId: 'file123' })).toString(
        'base64'
      ) as any,
    };

    const result = await docProcessor(cloudEvent);

    expect(result.message).toContain(
      'already exists in Cloud Storage, skipped upload'
    );
    expect(result.fileId).toBe('file123');
    expect(
      mockStorage.bucket().file().createWriteStream
    ).not.toHaveBeenCalled();
  }, 20000);
});
