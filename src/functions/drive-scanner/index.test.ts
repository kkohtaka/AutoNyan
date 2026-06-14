import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { driveScanner } from './index';

// Mock the Google APIs
jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        list: jest.fn(),
        get: jest.fn(),
      },
    }),
  },
}));

jest.mock('@google-cloud/pubsub');
jest.mock('@google-cloud/firestore');

const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;
const mockFirestore = Firestore as jest.MockedClass<typeof Firestore>;

describe('driveScanner', () => {
  let mockDriveList: jest.Mock;
  let mockDriveGet: jest.Mock;
  let mockPublishMessage: jest.Mock;
  let mockTopic: jest.Mock;
  let mockPubSubInstance: jest.Mocked<PubSub>;
  let mockDrive: any;
  let mockDocGet: jest.Mock;
  let mockDocSet: jest.Mock;
  let mockDoc: jest.Mock;
  let mockCollection: jest.Mock;

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

    // Set default environment variable for topic
    process.env.DOC_PROCESS_TRIGGER_TOPIC = 'doc-process-trigger';

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const { google } = require('googleapis');

    // Mock Drive API
    mockDriveList = jest.fn();
    mockDriveGet = jest.fn();
    mockDrive = {
      files: {
        list: mockDriveList,
        get: mockDriveGet,
      },
    };
    google.drive.mockReturnValue(mockDrive);

    google.auth.GoogleAuth.mockImplementation(() => ({}) as any);

    // Mock PubSub
    mockPublishMessage = jest.fn();
    mockTopic = jest.fn().mockReturnValue({
      publishMessage: mockPublishMessage,
    });
    mockPubSubInstance = {
      topic: mockTopic,
    } as any;
    mockPubSub.mockImplementation(() => mockPubSubInstance);

    // Mock Firestore: by default no file has been scanned before (exists=false)
    mockDocGet = jest.fn().mockResolvedValue({ exists: false });
    mockDocSet = jest.fn().mockResolvedValue(undefined);
    mockDoc = jest.fn().mockReturnValue({
      get: mockDocGet,
      set: mockDocSet,
    });
    mockCollection = jest.fn().mockReturnValue({
      doc: mockDoc,
    });
    mockFirestore.mockImplementation(
      () =>
        ({
          collection: mockCollection,
        }) as any
    );
  });

  describe('CloudEvent request', () => {
    it('should ACK (skip) when folderId is missing without retrying', async () => {
      const cloudEvent = buildEvent({});

      const result = await driveScanner(cloudEvent);

      expect(result.skipped).toBe(true);
      expect(result.filesFound).toBe(0);
      expect(result.publishedMessages).toBe(0);
      expect(result.message).toContain('Missing required fields: folderId');
      expect(mockDriveGet).not.toHaveBeenCalled();
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
      expect(result.skippedMessages).toBe(0);
      expect(result.topicName).toBe('doc-process-trigger');

      // Verify the file was recorded as scanned after publishing
      expect(mockCollection).toHaveBeenCalledWith('scanned_files');
      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const recordedDoc = mockDocSet.mock.calls[0][0];
      expect(recordedDoc).toMatchObject({
        fileId: 'file1',
        fileName: 'document1.pdf',
        modifiedTime: '2023-01-01T00:00:00.000Z',
        folderId: 'test-folder-id',
      });

      // Verify folder get was called
      expect(mockDriveGet).toHaveBeenCalledWith({
        fileId: 'test-folder-id',
        fields: 'id,name,mimeType',
        supportsAllDrives: true,
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
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
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

    it('should skip PubSub publishing when DOC_PROCESS_TRIGGER_TOPIC is not set', async () => {
      // Unset the environment variable
      delete process.env.DOC_PROCESS_TRIGGER_TOPIC;

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

      const result = await driveScanner(cloudEvent);

      expect(result).toBeDefined();
      expect(result.message).toContain(
        'Successfully scanned folder test-folder-id and found 1 document files'
      );
      expect(result.filesFound).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.publishedMessages).toBe(0); // No messages published
      expect(result.topicName).toBeNull(); // Topic is null

      // Verify PubSub was not called
      expect(mockPublishMessage).not.toHaveBeenCalled();
      expect(mockTopic).not.toHaveBeenCalled();
    });
  });

  describe('Idempotent publishing', () => {
    const folderEvent = (): CloudEvent<MessagePublishedData> =>
      buildEvent({ folderId: 'test-folder-id' });

    const singleFile = [
      {
        id: 'file1',
        name: 'document1.pdf',
        mimeType: 'application/pdf',
        size: '1024',
        modifiedTime: '2023-01-01T00:00:00.000Z',
        webViewLink: 'https://drive.google.com/file/d/file1/view',
      },
    ];

    beforeEach(() => {
      mockDriveGet.mockResolvedValue({
        data: {
          id: 'test-folder-id',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });
      mockDriveList.mockResolvedValue({
        data: { files: singleFile, nextPageToken: undefined },
      });
      mockPublishMessage.mockResolvedValue('message-id-1');
    });

    it('should skip files that were already scanned and not publish them', async () => {
      // Simulate the file already existing in the scanned_files collection
      mockDocGet.mockResolvedValue({ exists: true });

      const result = await driveScanner(folderEvent());

      expect(result.filesFound).toBe(1);
      expect(result.publishedMessages).toBe(0);
      expect(result.skippedMessages).toBe(1);

      // No publish and no new record when the file was already scanned
      expect(mockPublishMessage).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should publish and record files that have not been scanned before', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await driveScanner(folderEvent());

      expect(result.publishedMessages).toBe(1);
      expect(result.skippedMessages).toBe(0);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('should key the dedup record on fileId and modifiedTime', async () => {
      await driveScanner(folderEvent());

      // Both the existence check and the record write target the same doc id,
      // and the same file with a different modifiedTime yields a different id.
      const firstDocId = mockDoc.mock.calls[0][0];
      expect(typeof firstDocId).toBe('string');
      expect(firstDocId).toHaveLength(64); // sha256 hex digest

      jest.clearAllMocks();
      mockDriveGet.mockResolvedValue({
        data: { id: 'test-folder-id', name: 'Test Folder' },
      });
      mockDriveList.mockResolvedValue({
        data: {
          files: [
            { ...singleFile[0], modifiedTime: '2024-12-31T23:59:59.000Z' },
          ],
          nextPageToken: undefined,
        },
      });
      mockPublishMessage.mockResolvedValue('message-id-2');
      mockDocGet.mockResolvedValue({ exists: false });

      await driveScanner(folderEvent());
      const secondDocId = mockDoc.mock.calls[0][0];
      expect(secondDocId).not.toBe(firstDocId);
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

    it('should handle pagination when folder has more than 100 files', async () => {
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
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      expect(mockDriveList).toHaveBeenNthCalledWith(2, {
        q: expect.stringContaining(
          "'test-folder-id' in parents and trashed=false"
        ),
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 100,
        pageToken: 'next-page-token',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    });
  });
});
