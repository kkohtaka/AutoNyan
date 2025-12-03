import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { google } from 'googleapis';
import { driveScanner } from './index';

// Mock the Google APIs
jest.mock('googleapis');
jest.mock('@google-cloud/pubsub');

const mockGoogle = google as jest.Mocked<typeof google>;
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

describe('driveScanner', () => {
  let mockDriveList: jest.Mock;
  let mockDriveGet: jest.Mock;
  let mockPublishMessage: jest.Mock;
  let mockTopic: jest.Mock;
  let mockPubSubInstance: jest.Mocked<PubSub>;

  const buildEvent = (payload: any): CloudEvent<MessagePublishedData> => {
    return {
      id: 'test-id',
      specversion: '1.0',
      source: 'test-source',
      type: 'test-type',
      data: Buffer.from(JSON.stringify(payload)).toString('base64'),
    } as CloudEvent<MessagePublishedData>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Drive API
    mockDriveList = jest.fn();
    mockDriveGet = jest.fn();
    mockGoogle.drive.mockReturnValue({
      files: {
        list: mockDriveList,
        get: mockDriveGet,
      },
    } as any);

    (
      mockGoogle.auth.GoogleAuth as jest.MockedClass<
        typeof google.auth.GoogleAuth
      >
    ).mockImplementation(() => ({}) as any);

    // Mock PubSub
    mockPublishMessage = jest.fn();
    mockTopic = jest.fn().mockReturnValue({
      publishMessage: mockPublishMessage,
    });
    mockPubSubInstance = {
      topic: mockTopic,
    } as any;
    mockPubSub.mockImplementation(() => mockPubSubInstance);
  });

  describe('CloudEvent request', () => {
    it('should throw error when folderId is missing', async () => {
      const cloudEvent = buildEvent({});

      await expect(driveScanner(cloudEvent)).rejects.toThrow(
        'Missing required fields: folderId'
      );
    });

    it('should successfully process CloudEvent and return result', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
      });

      const mockFiles = [
        {
          id: 'file1',
          name: 'document1.pdf',
          mimeType: 'application/pdf',
          size: '1024',
          modifiedTime: '2023-01-01T00:00:00.000Z',
          webViewLink: 'https://drive.google.com/file/d/file1/view',
        },
      ];

      mockDriveGet.mockResolvedValue({
        data: {
          id: 'test-folder-id',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });

      mockDriveList.mockResolvedValue({
        data: {
          files: mockFiles,
          nextPageToken: undefined,
        },
      });

      mockPublishMessage.mockImplementation(() =>
        Promise.resolve('message-id-1')
      );

      const result = await driveScanner(cloudEvent);

      expect(result).toBeDefined();
      expect(result.message).toContain(
        'Successfully scanned folder test-folder-id and found 1 document files'
      );
      expect(result.filesFound).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.publishedMessages).toBe(1);
      expect(result.topicName).toBe('doc-process-trigger');

      // Verify folder get was called
      expect(mockDriveGet).toHaveBeenCalledWith({
        fileId: 'test-folder-id',
        fields: 'id,name,mimeType',
      });

      // Verify Drive API was called correctly with pagination fields
      expect(mockDriveList).toHaveBeenCalledWith({
        q: expect.stringContaining(
          "'test-folder-id' in parents and trashed=false"
        ),
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
        pageToken: undefined,
      });

      // Verify PubSub messages were published
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
      expect(mockTopic).toHaveBeenCalledWith('doc-process-trigger');

      // Verify message content
      const publishCall = mockPublishMessage.mock.calls[0][0];
      const messageData = JSON.parse(publishCall.data.toString());
      expect(messageData).toEqual({
        fileId: 'file1',
        fileName: 'document1.pdf',
        mimeType: 'application/pdf',
        size: '1024',
        modifiedTime: '2023-01-01T00:00:00.000Z',
        webViewLink: 'https://drive.google.com/file/d/file1/view',
        folderId: 'test-folder-id',
        scanTimestamp: expect.any(String),
      });
      expect(publishCall.attributes).toEqual({
        fileId: 'file1',
        mimeType: 'application/pdf',
        operation: 'document-classification',
      });
    });

    it('should handle errors in CloudEvent processing', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
      });

      mockDriveGet.mockRejectedValue(new Error('Drive API error'));

      await expect(driveScanner(cloudEvent)).rejects.toThrow(
        'Drive document scanner failed: Drive API error'
      );
    });
  });

  describe('Document type filtering', () => {
    it('should include all supported document MIME types in search query', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
      });

      mockDriveGet.mockResolvedValue({
        data: {
          id: 'test-folder-id',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });

      mockDriveList.mockResolvedValue({
        data: {
          files: [],
          nextPageToken: undefined,
        },
      });

      await driveScanner(cloudEvent);

      const callArgs = mockDriveList.mock.calls[0][0];
      const query = callArgs.q;

      // Check that query contains expected MIME types
      expect(query).toContain("mimeType='application/pdf'");
      expect(query).toContain("mimeType='application/msword'");
      expect(query).toContain(
        "mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
      );
      expect(query).toContain("mimeType='application/vnd.ms-excel'");
      expect(query).toContain(
        "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'"
      );
      expect(query).toContain("mimeType='application/vnd.ms-powerpoint'");
      expect(query).toContain(
        "mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation'"
      );
      expect(query).toContain("mimeType='text/plain'");
      expect(query).toContain("mimeType='application/rtf'");
      expect(query).toContain(
        "mimeType='application/vnd.google-apps.document'"
      );
      expect(query).toContain(
        "mimeType='application/vnd.google-apps.spreadsheet'"
      );
      expect(query).toContain(
        "mimeType='application/vnd.google-apps.presentation'"
      );
    });

    it.skip('should handle pagination when folder has more than 100 files', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
      });

      mockDriveGet.mockResolvedValue({
        data: {
          id: 'test-folder-id',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });

      // Mock two pages of results
      mockDriveList
        .mockResolvedValueOnce({
          data: {
            files: Array(5)
              .fill(null)
              .map((_, i) => ({
                id: `file${i + 1}`,
                name: `document${i + 1}.pdf`,
                mimeType: 'application/pdf',
                size: '1024',
                modifiedTime: '2023-01-01T00:00:00.000Z',
                webViewLink: `https://drive.google.com/file/d/file${i + 1}/view`,
              })),
            nextPageToken: 'next-page-token',
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: Array(3)
              .fill(null)
              .map((_, i) => ({
                id: `file${i + 6}`,
                name: `document${i + 6}.pdf`,
                mimeType: 'application/pdf',
                size: '1024',
                modifiedTime: '2023-01-01T00:00:00.000Z',
                webViewLink: `https://drive.google.com/file/d/file${i + 6}/view`,
              })),
            nextPageToken: undefined,
          },
        });

      mockPublishMessage.mockImplementation(() =>
        Promise.resolve('message-id')
      );

      const result = await driveScanner(cloudEvent);

      expect(result.filesFound).toBe(8);

      // Verify pagination calls
      expect(mockDriveList).toHaveBeenCalledTimes(2);
      expect(mockDriveList).toHaveBeenNthCalledWith(1, {
        q: expect.stringContaining(
          "'test-folder-id' in parents and trashed=false"
        ),
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
        pageToken: undefined,
      });
      expect(mockDriveList).toHaveBeenNthCalledWith(2, {
        q: expect.stringContaining(
          "'test-folder-id' in parents and trashed=false"
        ),
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
        pageToken: 'next-page-token',
      });
    });
  });
});
