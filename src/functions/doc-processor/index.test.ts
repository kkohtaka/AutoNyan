import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { PubSub } from '@google-cloud/pubsub';
import { docProcessor } from './index';

// Mock dependencies
const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue(undefined),
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

jest.mock('@google-cloud/pubsub');
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

describe('docProcessor', () => {
  let mockDrive: any;
  let mockPublishMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
    process.env.ENVIRONMENT = 'staging';
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const { google } = require('googleapis');
    mockDrive = google.drive();

    // Mock PubSub used for failure notifications
    mockPublishMessage = jest.fn().mockResolvedValue('message-id');
    mockPubSub.mockImplementation(
      () =>
        ({
          topic: jest.fn().mockReturnValue({
            publishMessage: mockPublishMessage,
          }),
        }) as any
    );
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.ENVIRONMENT;
    delete process.env.NOTIFICATION_TOPIC;
  });

  // Self-referencing so the chained .on('data').on('end') calls both fire.
  const mockDriveDownload = () => {
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
      .mockResolvedValueOnce({ data: mockStream });
  };

  const buildCloudEvent = (): CloudEvent<MessagePublishedData> => ({
    id: 'test-event-id',
    source: 'test-source',
    specversion: '1.0',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    time: '2023-01-01T00:00:00.000Z',
    data: Buffer.from(JSON.stringify({ fileId: 'file123' })).toString(
      'base64'
    ) as any,
  });

  // Drain the Drive download's nextTick chain so the upload is reached.
  const flushAsync = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => process.nextTick(resolve));
    }
  };

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

  test('should publish a failure notification on permanent failure when NOTIFICATION_TOPIC is set', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    // Drive returns invalid file data -> permanent failure
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

    await docProcessor(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
          fileId: 'file123',
        }),
      })
    );
  });

  test('should not fail when notification publishing throws', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';
    mockPublishMessage.mockRejectedValueOnce(new Error('publish failed'));

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
    mockDriveDownload();
    mockStorage.bucket().file().exists.mockResolvedValueOnce([true]);

    const result = await docProcessor(buildCloudEvent());

    expect(result.message).toContain(
      'already exists in Cloud Storage, skipped upload'
    );
    expect(result.fileId).toBe('file123');
    expect(mockStorage.bucket().file().save).not.toHaveBeenCalled();
  }, 20000);

  test('should not read object metadata before the upload completes', async () => {
    mockDriveDownload();

    const callOrder: string[] = [];
    let completeUpload!: () => void;
    const uploadFinished = new Promise<void>((resolve) => {
      completeUpload = resolve;
    });

    mockStorage
      .bucket()
      .file()
      .save.mockImplementationOnce(async () => {
        callOrder.push('save:start');
        await uploadFinished;
        callOrder.push('save:complete');
      });
    mockStorage
      .bucket()
      .file()
      .getMetadata.mockImplementationOnce(async () => {
        callOrder.push('getMetadata');
        return [{ size: '1024' }];
      });

    const pending = docProcessor(buildCloudEvent());

    await flushAsync();
    expect(callOrder).toEqual(['save:start']);

    completeUpload();
    await pending;

    expect(callOrder).toEqual(['save:start', 'save:complete', 'getMetadata']);
  }, 20000);

  test('should reject when the upload fails', async () => {
    mockDriveDownload();

    mockStorage
      .bucket()
      .file()
      .save.mockRejectedValueOnce(new Error('upload stream failed'));

    await expect(docProcessor(buildCloudEvent())).rejects.toThrow(
      'upload stream failed'
    );
    expect(mockStorage.bucket().file().getMetadata).not.toHaveBeenCalled();
  }, 20000);
});
