import { fileClassifier } from './index';

// Mock dependencies
jest.mock('@google-cloud/firestore');
jest.mock('google-auth-library');
jest.mock('./drive-operations');
jest.mock('./classification');
jest.mock('./firestore-operations');

const mockGoogleAuth = { mockGoogleAuthInstance: true };
const mockFirestore = {};

const mockListCategoryFolders = jest.fn();
const mockMoveFileInDrive = jest.fn();
const mockClassifyWithGemini = jest.fn();
const mockParseDocumentData = jest.fn();
const mockUpdateDocumentWithClassification = jest.fn();

// Mock the constructors and modules
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('google-auth-library').GoogleAuth = jest.fn(() => mockGoogleAuth);

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('@google-cloud/firestore').Firestore = jest.fn(() => mockFirestore);

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('./drive-operations').listCategoryFolders = mockListCategoryFolders;
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('./drive-operations').moveFileInDrive = mockMoveFileInDrive;
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('./classification').classifyWithGemini = mockClassifyWithGemini;
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('./firestore-operations').parseDocumentData = mockParseDocumentData;
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
require('./firestore-operations').updateDocumentWithClassification =
  mockUpdateDocumentWithClassification;

describe('fileClassifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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

  const createFirestoreEvent = (
    fields: Record<string, unknown>,
    docId: string = 'doc123'
  ) => ({
    data: {
      value: {
        fields: fields,
      },
    },
    document: `projects/test-project/databases/(default)/documents/extracted_texts/${docId}`,
  });

  it('should classify document and move to category folder', async () => {
    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-123' },
      fileName: { stringValue: 'invoice.pdf' },
      extractedText: {
        stringValue: '請求書 金額: 10000円 支払期限: 2024-01-31',
      },
    });

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      extractedText: '請求書 金額: 10000円 支払期限: 2024-01-31',
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
      mockGoogleAuth,
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
      mockGoogleAuth,
      'file-123',
      'folder-invoices'
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      mockFirestore,
      'extracted_texts/doc123',
      expect.objectContaining({
        category: '請求書',
        categoryFolderId: 'folder-invoices',
        classificationConfidence: 0.95,
        classificationReasoning: 'Document contains invoice-related keywords',
      })
    );
  });

  it('should move to uncategorized folder when no category matches', async () => {
    const event = createFirestoreEvent(
      {
        fileId: { stringValue: 'file-456' },
        fileName: { stringValue: 'unknown.pdf' },
        extractedText: { stringValue: 'Random text with no clear category' },
      },
      'doc456'
    );

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-456',
      fileName: 'unknown.pdf',
      extractedText: 'Random text with no clear category',
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-invoices', name: '請求書' },
      { id: 'folder-contracts', name: '契約書' },
    ]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: null,
      categoryFolderId: null,
      confidence: 0.3,
      reasoning: 'No matching category found',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.message).toContain('Successfully classified and moved file');
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0.3);

    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      mockGoogleAuth,
      'file-456',
      'uncategorized-folder-id'
    );
    expect(mockUpdateDocumentWithClassification).toHaveBeenCalledWith(
      mockFirestore,
      'extracted_texts/doc456',
      expect.objectContaining({
        category: null,
        categoryFolderId: 'uncategorized-folder-id',
      })
    );
  });

  it('should handle missing environment variables', async () => {
    delete process.env.CATEGORY_ROOT_FOLDER_ID;

    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-123' },
      fileName: { stringValue: 'test.pdf' },
      extractedText: { stringValue: 'test content' },
    });

    await expect(fileClassifier(event)).rejects.toThrow(
      'Missing required environment variables'
    );
  });

  it('should handle classification errors gracefully', async () => {
    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-789' },
      fileName: { stringValue: 'error.pdf' },
      extractedText: { stringValue: 'test content' },
    });

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-789',
      fileName: 'error.pdf',
      extractedText: 'test content',
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-test', name: 'Test' },
    ]);

    mockClassifyWithGemini.mockRejectedValue(new Error('Gemini API error'));

    await expect(fileClassifier(event)).rejects.toThrow(
      'File classification failed'
    );
  });

  it('should handle Drive API errors when moving files', async () => {
    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-999' },
      fileName: { stringValue: 'move-error.pdf' },
      extractedText: { stringValue: 'test content' },
    });

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-999',
      fileName: 'move-error.pdf',
      extractedText: 'test content',
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-test', name: 'Test' },
    ]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: 'Test',
      categoryFolderId: 'folder-test',
      confidence: 0.9,
      reasoning: 'Test classification',
    });

    mockMoveFileInDrive.mockRejectedValue(new Error('Permission denied'));

    await expect(fileClassifier(event)).rejects.toThrow(
      'File classification failed'
    );
  });

  it('should handle empty category folders list', async () => {
    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-empty' },
      fileName: { stringValue: 'empty.pdf' },
      extractedText: { stringValue: 'test content' },
    });

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-empty',
      fileName: 'empty.pdf',
      extractedText: 'test content',
    });

    mockListCategoryFolders.mockResolvedValue([]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: null,
      categoryFolderId: null,
      confidence: 0,
      reasoning: 'No categories available',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.category).toBeNull();
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      mockGoogleAuth,
      'file-empty',
      'uncategorized-folder-id'
    );
  });

  it('should handle Firestore event with complex field types (integerValue, doubleValue, arrayValue, mapValue)', async () => {
    const event = createFirestoreEvent({
      fileId: { stringValue: 'file-789' },
      fileName: { stringValue: 'complex-doc.pdf' },
      extractedText: { stringValue: 'Contract document with details' },
      fileSize: { integerValue: 524288 },
      confidence: { doubleValue: 0.98 },
      pages: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  pageNumber: { integerValue: 1 },
                  text: { stringValue: 'Page 1 content' },
                  confidence: { doubleValue: 0.99 },
                },
              },
            },
            {
              mapValue: {
                fields: {
                  pageNumber: { integerValue: 2 },
                  text: { stringValue: 'Page 2 content' },
                  confidence: { doubleValue: 0.97 },
                },
              },
            },
          ],
        },
      },
    });

    mockParseDocumentData.mockReturnValue({
      fileId: 'file-789',
      fileName: 'complex-doc.pdf',
      extractedText: 'Contract document with details',
      fileSize: 524288,
      confidence: 0.98,
      pages: [
        { pageNumber: 1, text: 'Page 1 content', confidence: 0.99 },
        { pageNumber: 2, text: 'Page 2 content', confidence: 0.97 },
      ],
    });

    mockListCategoryFolders.mockResolvedValue([
      { id: 'folder-contracts', name: '契約書' },
    ]);

    mockClassifyWithGemini.mockResolvedValue({
      categoryName: '契約書',
      categoryFolderId: 'folder-contracts',
      confidence: 0.92,
      reasoning: 'Document identified as contract',
    });

    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockUpdateDocumentWithClassification.mockResolvedValue(undefined);

    const result = await fileClassifier(event);

    expect(result.message).toContain('Successfully classified and moved file');
    expect(result.category).toBe('契約書');
    expect(result.fileName).toBe('complex-doc.pdf');
    expect(mockMoveFileInDrive).toHaveBeenCalledWith(
      mockGoogleAuth,
      'file-789',
      'folder-contracts'
    );
  });
});
