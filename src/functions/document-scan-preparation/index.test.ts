import { documentScanPreparation } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { google } from 'googleapis';

// Mock dependencies
const mockStorage = {
  bucket: jest.fn().mockReturnValue({
    file: jest.fn().mockReturnValue({
      createWriteStream: jest.fn().mockReturnValue({
        write: jest.fn().mockImplementation((buffer, callback) => {
          callback();
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

describe('documentScanPreparation', () => {
  let mockDrive: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_ID = 'test-project';
    mockDrive = (google.drive as jest.Mock)();
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
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
              process.nextTick(() =>
                callback(Buffer.from('test file content'))
              );
            } else if (event === 'end') {
              // Call the callback immediately to end the stream
              process.nextTick(() => callback());
            } else if (event === 'error') {
              // Return this to chain
            }
            return {
              on: jest.fn().mockImplementation((event) => {
                if (event === 'error') {
                  // No error in this test case
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

    const result = await documentScanPreparation(cloudEvent);

    expect(result.message).toContain(
      'Successfully copied file test-document.pdf'
    );
    expect(result.fileId).toBe('file123');
    expect(result.fileName).toBe('test-document.pdf');
    expect(result.bucketName).toBe('test-project-document-storage');
    expect(result.contentType).toBe('application/pdf');
    expect(result.size).toBe(1024);
    expect(result.objectName).toMatch(/^documents\/[a-f0-9]{64}\.pdf$/); // SHA256 hash + extension

    // Verify Drive API calls
    expect(mockDrive.files.get).toHaveBeenCalledWith({
      fileId: 'file123',
      fields: 'id,name,mimeType,size,modifiedTime',
    });

    expect(mockDrive.files.get).toHaveBeenCalledWith(
      {
        fileId: 'file123',
        alt: 'media',
      },
      {
        responseType: 'stream',
      }
    );
  }, 10000);

  test('should throw error when no fileId is provided', async () => {
    const messageData = {};

    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: Buffer.from(JSON.stringify(messageData)).toString('base64') as any,
    };

    await expect(documentScanPreparation(cloudEvent)).rejects.toThrow(
      'Missing required parameter: fileId'
    );
  });

  test('should throw error when no message data is provided', async () => {
    const cloudEvent: CloudEvent<MessagePublishedData> = {
      id: 'test-event-id',
      source: 'test-source',
      specversion: '1.0',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: '2023-01-01T00:00:00.000Z',
      data: null as any,
    };

    await expect(documentScanPreparation(cloudEvent)).rejects.toThrow(
      'No message data found in CloudEvent'
    );
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

    await expect(documentScanPreparation(cloudEvent)).rejects.toThrow(
      'Document scan preparation failed: Drive API error'
    );
  });
});
