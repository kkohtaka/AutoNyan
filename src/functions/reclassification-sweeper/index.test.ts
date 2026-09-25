import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { PubSub } from '@google-cloud/pubsub';
import { categoryFolderSetHash } from 'autonyan-shared';
import { reclassificationSweeper } from './index';

jest.mock('@google-cloud/firestore');
const mockFirestore = Firestore as jest.MockedClass<typeof Firestore>;

jest.mock('@google-cloud/pubsub');
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

jest.mock('autonyan-shared', () => ({
  ...jest.requireActual('autonyan-shared'),
  createDriveAuth: jest.fn().mockResolvedValue({ mockDriveAuth: true }),
}));

jest.mock('./drive-operations');

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const { createDriveAuth: mockCreateDriveAuth } = require('autonyan-shared');

const mockListCategoryFolders = jest.fn();
const mockGetFileState = jest.fn();

interface StoredDocument {
  fileId?: string;
  fileName?: string;
  extractedText?: string;
  confidence?: number;
  modifiedTime?: string;
  objectName?: string;
  categoryFolderSetHash?: string;
}

describe('reclassificationSweeper', () => {
  let mockPublishMessage: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockGet: jest.Mock;

  const currentHash = categoryFolderSetHash(['folder-a', 'folder-b']);
  const previousHash = categoryFolderSetHash(['folder-a']);

  const cloudEvent: CloudEvent<MessagePublishedData> = {
    specversion: '1.0',
    id: 'test-event-id',
    source: 'test-source',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    time: new Date().toISOString(),
    data: {
      data: Buffer.from(JSON.stringify({})).toString('base64'),
      message_id: 'test-message-id',
      publish_time: new Date().toISOString(),
    } as unknown as MessagePublishedData,
  };

  const givenDocuments = (documents: StoredDocument[]): void => {
    mockGet.mockResolvedValue({
      size: documents.length,
      docs: documents.map((data, index) => ({
        id: `doc-${index}`,
        data: () => data,
        ref: { update: mockUpdate },
      })),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPublishMessage = jest.fn().mockResolvedValue('message-id');
    mockPubSub.mockImplementation(
      () =>
        ({
          topic: jest.fn().mockReturnValue({
            publishMessage: mockPublishMessage,
          }),
        }) as never
    );

    mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockGet = jest.fn();
    mockFirestore.mockImplementation(
      () =>
        ({
          collection: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ get: mockGet }),
          }),
        }) as never
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const driveOps = require('./drive-operations');
    driveOps.listCategoryFolders = mockListCategoryFolders;
    driveOps.getFileState = mockGetFileState;

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-a', name: '請求書' },
      { id: 'folder-b', name: '契約書' },
    ]);
    mockGetFileState.mockResolvedValue({
      parents: ['uncategorized-folder-id'],
    });

    process.env.CATEGORY_ROOT_FOLDER_ID = 'root-folder-id';
    process.env.UNCATEGORIZED_FOLDER_ID = 'uncategorized-folder-id';
    process.env.FILE_CLASSIFIER_TOPIC = 'file-classification-trigger';
  });

  afterEach(() => {
    delete process.env.CATEGORY_ROOT_FOLDER_ID;
    delete process.env.UNCATEGORIZED_FOLDER_ID;
    delete process.env.FILE_CLASSIFIER_TOPIC;
  });

  it('should republish a document whose stored folder set is out of date', async () => {
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書 金額: 10000円',
        confidence: 0.92,
        categoryFolderSetHash: previousHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith({
      json: {
        firestoreDocId: 'doc-0',
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書 金額: 10000円',
        confidence: 0.92,
        reclassification: true,
      },
      attributes: {
        operation: 'file-classification',
        fileId: 'file-123',
      },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      categoryFolderSetHash: currentHash,
    });
    expect(result.republished).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockCreateDriveAuth).toHaveBeenCalledWith([
      'https://www.googleapis.com/auth/drive.readonly',
    ]);
  });

  it('should republish a document classified before the hash was recorded', async () => {
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書',
        confidence: 0.9,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(result.republished).toBe(1);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);
  });

  it('should skip a document already tried against the current folder set', async () => {
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書',
        confidence: 0.9,
        categoryFolderSetHash: currentHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockGetFileState).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.republished).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should carry the stored modifiedTime and source object on the republished message', async () => {
    mockGetFileState.mockResolvedValue({
      parents: ['uncategorized-folder-id'],
      modifiedTime: '2026-09-22T00:00:00.000Z',
    });
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'newsletter.pdf',
        extractedText: '9月の予定',
        confidence: 0.9,
        modifiedTime: '2026-08-31T00:00:00.000Z',
        objectName: 'documents/abc123',
        categoryFolderSetHash: previousHash,
      },
    ]);

    await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          modifiedTime: '2026-08-31T00:00:00.000Z',
          objectName: 'documents/abc123',
        }),
      })
    );
  });

  it("should fall back to Drive's modifiedTime for a document extracted before it was stored", async () => {
    mockGetFileState.mockResolvedValue({
      parents: ['uncategorized-folder-id'],
      modifiedTime: '2026-09-01T00:00:00.000Z',
    });
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'newsletter.pdf',
        extractedText: '9月の予定',
        confidence: 0.9,
        categoryFolderSetHash: previousHash,
      },
    ]);

    await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          modifiedTime: '2026-09-01T00:00:00.000Z',
        }),
      })
    );
  });

  it('should skip a document the user has already filed by hand', async () => {
    mockGetFileState.mockResolvedValue({ parents: ['some-category-folder'] });
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書',
        confidence: 0.9,
        categoryFolderSetHash: previousHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      categoryFolderSetHash: currentHash,
    });
    expect(result.republished).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip a document without stored extracted text', async () => {
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'scan.pdf',
        extractedText: '',
        confidence: 0,
        categoryFolderSetHash: previousHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockGetFileState).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('should skip a document whose Drive file no longer exists', async () => {
    mockGetFileState.mockResolvedValue(null);
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書',
        confidence: 0.9,
        categoryFolderSetHash: previousHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      categoryFolderSetHash: currentHash,
    });
    expect(result.republished).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip the sweep entirely when no category folder is visible', async () => {
    mockListCategoryFolders.mockResolvedValue([]);
    givenDocuments([
      {
        fileId: 'file-123',
        fileName: 'invoice.pdf',
        extractedText: '請求書',
        confidence: 0.9,
        categoryFolderSetHash: previousHash,
      },
    ]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.candidates).toBe(0);
    expect(result.republished).toBe(0);
  });

  it('should republish nothing when there are no uncategorized documents', async () => {
    givenDocuments([]);

    const result = await reclassificationSweeper(cloudEvent);

    expect(result.candidates).toBe(0);
    expect(result.republished).toBe(0);
  });

  it('should throw when required environment variables are missing', async () => {
    delete process.env.CATEGORY_ROOT_FOLDER_ID;

    await expect(reclassificationSweeper(cloudEvent)).rejects.toThrow(
      'Re-classification sweep failed'
    );
  });

  it('should throw when the classifier topic is not configured', async () => {
    delete process.env.FILE_CLASSIFIER_TOPIC;

    await expect(reclassificationSweeper(cloudEvent)).rejects.toThrow(
      'Re-classification sweep failed'
    );
  });

  it('should stop republishing at the per-sweep limit', async () => {
    givenDocuments(
      Array.from({ length: 55 }, (_, index) => ({
        fileId: `file-${index}`,
        fileName: `doc-${index}.pdf`,
        extractedText: '本文',
        confidence: 0.8,
        categoryFolderSetHash: previousHash,
      }))
    );

    const result = await reclassificationSweeper(cloudEvent);

    expect(result.republished).toBe(50);
    expect(mockPublishMessage).toHaveBeenCalledTimes(50);
  });
});
