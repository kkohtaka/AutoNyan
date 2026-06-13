import { fileClassifier } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';

// Mock dependencies
jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({})),
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(() => ({ mockGoogleAuthInstance: true })),
    },
  },
}));

jest.mock('./drive-operations');
jest.mock('./classification');
jest.mock('./firestore-operations');

const mockListCategoryFolders = jest.fn();
const mockMoveFileInDrive = jest.fn();
const mockClassifyWithGemini = jest.fn();
const mockUpdateDocumentWithClassification = jest.fn();

describe('fileClassifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock implementations for imported functions
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const driveOps = require('./drive-operations');
    driveOps.listCategoryFolders = mockListCategoryFolders;
    driveOps.moveFileInDrive = mockMoveFileInDrive;

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const classification = require('./classification');
    classification.classifyWithGemini = mockClassifyWithGemini;

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const firestoreOps = require('./firestore-operations');
    firestoreOps.updateDocumentWithClassification =
      mockUpdateDocumentWithClassification;

    // Set up environment variables
    process.env.PROJECT_ID = 'test-project';
    process.env.CATEGORY_ROOT_FOLDER_ID = 'root-folder-id';
    process.env.UNCATEGORIZED_FOLDER_ID = 'uncategorized-folder-id';
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.CATEGORY_ROOT_FOLDER_ID;
    delete process.env.UNCATEGORIZED_FOLDER_ID;
  });

  const createPubSubEvent = (data: {
    firestoreDocId: string;
    fileId: string;
    fileName: string;
    extractedText: string;
    confidence: number;
  }): CloudEvent<MessagePublishedData> => ({
    specversion: '1.0',
    id: 'test-event-id',
    source: 'test-source',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    time: new Date().toISOString(),
    data: {
      data: Buffer.from(JSON.stringify(data)).toString('base64'),
      message_id: 'test-message-id',
      publish_time: new Date().toISOString(),
    } as unknown as MessagePublishedData,
  });

  it('should classify document and move to category folder', async () => {
    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書 金額: 10000円 支払期限: 2024-01-31',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
      { id: 'folder-contracts', name: '契約書' },
    ]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'Document contains invoice-related keywords',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.message).toContain('Successfully classified and moved file');
    expect(result.category).toBe('請求書');
    expect(result.confidence).toBe(0.95);
    expect(result.fileId).toBe('file-123');
    expect(result.fileName).toBe('invoice.pdf');

    expect(mockListCategoryFolders).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'root-folder-id'
    );
    expect(mockClassifyWithGemini).toHaveBeenCalledWith(
      'test-project',
      '請求書 金額: 10000円 支払期限: 2024-01-31',
      [
        { id: 'folder-invoices', name: '請求書' },
        { id: 'folder-contracts', name: '契約書' },
      ]
    );
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-123',
      'folder-invoices'
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      expect.any(Object),
      'extracted_texts/doc123',
      {
        category: '請求書',
        categoryFolderId: 'folder-invoices',
        classificationConfidence: 0.95,
        classificationReasoning: 'Document contains invoice-related keywords',
        classifiedAt: expect.any(String),
      }
    );
  });

  it('should move to uncategorized folder if no category matched', async () => {
    const event = createPubSubEvent({
      firestoreDocId: 'doc456',
      fileId: 'file-456',
      fileName: 'unknown.pdf',
      extractedText: 'Some random text',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: null,
      categoryFolderId: null,
      confidence: 0.3,
      reasoning: 'Cannot determine category',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.category).toBeNull();
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-456',
      'uncategorized-folder-id'
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      expect.any(Object),
      'extracted_texts/doc456',
      expect.objectContaining({
        category: null,
        categoryFolderId: 'uncategorized-folder-id',
      })
    );
  });

  it('should throw error if required environment variables are missing', async () => {
    delete process.env.CATEGORY_ROOT_FOLDER_ID;

    const event = createPubSubEvent({
      firestoreDocId: 'doc789',
      fileId: 'file-789',
      fileName: 'test.pdf',
      extractedText: 'Test content',
      confidence: 1,
    });

    await expect(fileClassifier(event)).rejects.toThrow(
      'Missing required environment variables'
    );
  });

  it('should ACK (skip) if required fields are missing without retrying', async () => {
    // Create event with missing fileName field
    const event: CloudEvent<MessagePublishedData> = {
      specversion: '1.0',
      id: 'test-event-id',
      source: 'test-source',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      time: new Date().toISOString(),
      data: {
        data: Buffer.from(
          JSON.stringify({
            firestoreDocId: 'doc-missing',
            fileId: 'file-missing',
            extractedText: 'Test',
            confidence: 1,
          })
        ).toString('base64'),
        message_id: 'test-message-id',
        publish_time: new Date().toISOString(),
      } as unknown as MessagePublishedData,
    };

    const result = await fileClassifier(event);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('Missing required field');
  });
});
