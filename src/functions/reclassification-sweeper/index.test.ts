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

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(() => ({ mockGoogleAuthInstance: true })),
    },
  },
}));

jest.mock('./drive-operations');

const mockListCategoryFolders = jest.fn();
const mockGetFileParents = jest.fn();

interface StoredDocument {
  fileId?: string;
  fileName?: string;
  extractedText?: string;
  confidence?: number;
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
    driveOps.getFileParents = mockGetFileParents;

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-a', name: '請求書' },
      { id: 'folder-b', name: '契約書' },
    ]);
    mockGetFileParents.mockResolvedValue(['uncategorized-folder-id']);

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
    expect(mockGetFileParents).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.republished).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip a document the user has already filed by hand', async () => {
    mockGetFileParents.mockResolvedValue(['some-category-folder']);
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
    expect(mockGetFileParents).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
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
