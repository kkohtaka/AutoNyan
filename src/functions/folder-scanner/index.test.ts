import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { folderScanner } from './index';
import { google } from 'googleapis';
import { PubSub } from '@google-cloud/pubsub';

// Mock the Google APIs
jest.mock('googleapis');
jest.mock('@google-cloud/pubsub');

const mockGoogle = google as jest.Mocked<typeof google>;
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

describe('folderScanner', () => {
  let mockDriveList: jest.Mock;
  let mockPublishMessage: jest.Mock;
  let mockTopic: jest.Mock;
  let mockPubSubInstance: jest.Mocked<PubSub>;

  const buildEvent = (payload: any): CloudEvent<MessagePublishedData> => {
    return {
      id: 'test-id',
      data: {
        message: {
          data: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
      },
    } as CloudEvent<MessagePublishedData>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Drive API
    mockDriveList = jest.fn();
    mockGoogle.drive.mockReturnValue({
      files: {
        list: mockDriveList,
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
      const cloudEvent = buildEvent({ topicName: 'test-topic' });

      await expect(folderScanner(cloudEvent)).rejects.toThrow(
        'Missing required parameters: folderId and topicName'
      );
    });

    it('should throw error when topicName is missing', async () => {
      const cloudEvent = buildEvent({ folderId: 'test-folder-id' });

      await expect(folderScanner(cloudEvent)).rejects.toThrow(
        'Missing required parameters: folderId and topicName'
      );
    });

    it('should successfully process CloudEvent and return result', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
        topicName: 'test-topic',
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

      mockDriveList.mockResolvedValue({
        data: {
          files: mockFiles,
        },
      });

      mockPublishMessage.mockResolvedValue('message-id-1');

      const result = await folderScanner(cloudEvent);

      expect(result).toBeDefined();
      expect(result.message).toContain(
        'Successfully scanned folder test-folder-id and found 1 document files'
      );
      expect(result.filesFound).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.publishedMessages).toBe(1);
      expect(result.topicName).toBe('test-topic');

      // Verify Drive API was called correctly
      expect(mockDriveList).toHaveBeenCalledWith({
        q: expect.stringContaining(
          "'test-folder-id' in parents and trashed=false"
        ),
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
      });

      // Verify PubSub messages were published
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
      expect(mockTopic).toHaveBeenCalledWith('test-topic');

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
        topicName: 'test-topic',
      });

      mockDriveList.mockRejectedValue(new Error('Drive API error'));

      await expect(folderScanner(cloudEvent)).rejects.toThrow(
        'Drive document scanner failed: Drive API error'
      );
    });
  });

  describe('Document type filtering', () => {
    it('should include all supported document MIME types in search query', async () => {
      const cloudEvent = buildEvent({
        folderId: 'test-folder-id',
        topicName: 'test-topic',
      });

      mockDriveList.mockResolvedValue({
        data: {
          files: [],
        },
      });

      await folderScanner(cloudEvent);

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
  });
});
