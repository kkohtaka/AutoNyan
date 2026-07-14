import { fileClassifier } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { PubSub } from '@google-cloud/pubsub';

// Mock dependencies
jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({})),
}));

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
jest.mock('./classification');
jest.mock('./firestore-operations');
jest.mock('./rename');

const mockListCategoryFolders = jest.fn();
const mockListFileNamesInFolder = jest.fn();
const mockMoveFileInDrive = jest.fn();
const mockClassifyWithGemini = jest.fn();
const mockUpdateDocumentWithClassification = jest.fn();
const mockGenerateFileName = jest.fn();
const mockResolveRenamedFileName = jest.fn();

describe('fileClassifier', () => {
  let mockPublishMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock PubSub used for success/failure notifications
    mockPublishMessage = jest.fn().mockResolvedValue('message-id');
    mockPubSub.mockImplementation(
      () =>
        ({
          topic: jest.fn().mockReturnValue({
            publishMessage: mockPublishMessage,
          }),
        }) as any
    );

    // Set up mock implementations for imported functions
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const driveOps = require('./drive-operations');
    driveOps.listCategoryFolders = mockListCategoryFolders;
    driveOps.listFileNamesInFolder = mockListFileNamesInFolder;
    driveOps.moveFileInDrive = mockMoveFileInDrive;

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const classification = require('./classification');
    classification.classifyWithGemini = mockClassifyWithGemini;

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const firestoreOps = require('./firestore-operations');
    firestoreOps.updateDocumentWithClassification =
      mockUpdateDocumentWithClassification;

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const rename = require('./rename');
    rename.generateFileName = mockGenerateFileName;
    rename.resolveRenamedFileName = mockResolveRenamedFileName;

    // Defaults: name generation succeeds but the guards keep the original name
    mockListFileNamesInFolder.mockResolvedValue([]);
    mockGenerateFileName.mockResolvedValue({
      fileName: '生成された名前',
      confidence: 0.9,
      reasoning: '内容から命名',
    });
    mockResolveRenamedFileName.mockReturnValue(null);

    // Set up environment variables
    process.env.PROJECT_ID = 'test-project';
    process.env.CATEGORY_ROOT_FOLDER_ID = 'root-folder-id';
    process.env.UNCATEGORIZED_FOLDER_ID = 'uncategorized-folder-id';
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.CATEGORY_ROOT_FOLDER_ID;
    delete process.env.UNCATEGORIZED_FOLDER_ID;
    delete process.env.NOTIFICATION_TOPIC;
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

  it('should classify document and move to category folder with a renamed file name', async () => {
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
      summary: '請求書に関する文書です。',
    });

    mockListFileNamesInFolder.mockResolvedValue([
      '2024-01-15_請求書_ネコ商会.pdf',
    ]);
    mockGenerateFileName.mockResolvedValue({
      fileName: '2024-01-31_請求書_サンプル商事',
      confidence: 0.9,
      reasoning: '既存の命名規則に合わせました',
    });
    mockResolveRenamedFileName.mockReturnValue(
      '2024-01-31_請求書_サンプル商事.pdf'
    );

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
    expect(mockListFileNamesInFolder).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'folder-invoices'
    );
    expect(mockGenerateFileName).toHaveBeenCalledWith(
      'test-project',
      '請求書 金額: 10000円 支払期限: 2024-01-31',
      'invoice.pdf',
      ['2024-01-15_請求書_ネコ商会.pdf']
    );
    expect(mockResolveRenamedFileName).toHaveBeenCalledWith(
      {
        fileName: '2024-01-31_請求書_サンプル商事',
        confidence: 0.9,
        reasoning: '既存の命名規則に合わせました',
      },
      'invoice.pdf',
      ['2024-01-15_請求書_ネコ商会.pdf']
    );
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-123',
      'folder-invoices',
      '2024-01-31_請求書_サンプル商事.pdf'
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
        summary: '請求書に関する文書です。',
        originalFileName: 'invoice.pdf',
        renamedFileName: '2024-01-31_請求書_サンプル商事.pdf',
        renameConfidence: 0.9,
        renameReasoning: '既存の命名規則に合わせました',
      }
    );
  });

  it('should keep the original name when the rename guards reject the proposal', async () => {
    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'invoice',
      summary: '請求書です。',
    });
    // Defaults: generateFileName succeeds, resolveRenamedFileName returns null

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    await fileClassifier(event);

    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-123',
      'folder-invoices',
      undefined
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      expect.any(Object),
      'extracted_texts/doc123',
      expect.objectContaining({
        originalFileName: 'invoice.pdf',
        renamedFileName: null,
        renameConfidence: 0.9,
        renameReasoning: '内容から命名',
      })
    );
  });

  it('should keep the original name when name generation fails', async () => {
    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'invoice',
      summary: '請求書です。',
    });
    mockGenerateFileName.mockRejectedValue(new Error('Gemini unavailable'));

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.category).toBe('請求書');
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-123',
      'folder-invoices',
      undefined
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      expect.any(Object),
      'extracted_texts/doc123',
      expect.objectContaining({
        originalFileName: 'invoice.pdf',
        renamedFileName: null,
        renameConfidence: null,
        renameReasoning: null,
      })
    );
  });

  it('should not fail when the move and rename call fails', async () => {
    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'invoice',
      summary: '請求書です。',
    });
    mockResolveRenamedFileName.mockReturnValue('請求書_2024-01.pdf');
    mockMoveFileInDrive.mockRejectedValue(
      new Error('insufficient permissions')
    );
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.message).toContain('file move failed');
    expect(result.category).toBe('請求書');
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalled();
  });

  it('should publish a success notification when NOTIFICATION_TOPIC is set', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書 金額: 10000円',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'invoice',
      summary: '請求書です。',
    });
    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    await fileClassifier(event);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'success-notification',
          fileId: 'file-123',
        }),
      })
    );
  });

  it('should not fail when success notification publishing throws', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';
    mockPublishMessage.mockRejectedValueOnce(new Error('publish failed'));

    const event = createPubSubEvent({
      firestoreDocId: 'doc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書',
      confidence: 1,
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
    ]);
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.95,
      reasoning: 'invoice',
      summary: '請求書です。',
    });
    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.category).toBe('請求書');
  });

  it('should publish a failure notification on permanent failure when NOTIFICATION_TOPIC is set', async () => {
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';

    // Missing required fields -> permanent failure
    const event: CloudEvent<MessagePublishedData> = {
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

    const result = await fileClassifier(event);

    expect(result.skipped).toBe(true);
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: 'failure-notification',
        }),
      })
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
      summary: '不明なカテゴリの文書です。',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.category).toBeNull();
    expect(mockListFileNamesInFolder).not.toHaveBeenCalled();
    expect(mockGenerateFileName).not.toHaveBeenCalled();
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      expect.objectContaining({ mockGoogleAuthInstance: true }),
      'file-456',
      'uncategorized-folder-id',
      undefined
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      expect.any(Object),
      'extracted_texts/doc456',
      expect.objectContaining({
        category: null,
        categoryFolderId: 'uncategorized-folder-id',
        originalFileName: 'unknown.pdf',
        renamedFileName: null,
        renameConfidence: null,
        renameReasoning: null,
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
