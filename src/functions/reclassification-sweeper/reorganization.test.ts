import { Firestore } from '@google-cloud/firestore';
import { Topic } from '@google-cloud/pubsub';
import {
  CategoryFolder,
  DriveAuth,
  folderOrganizationFingerprint,
  namingRuleHash,
} from 'autonyan-shared';
import { sweepFiledDocuments } from './reorganization';

jest.mock('./drive-operations');

const mockGetFileState = jest.fn();

interface StoredDocument {
  fileId?: string;
  fileName?: string;
  originalFileName?: string;
  renamedFileName?: string | null;
  organizationFingerprint?: string;
  namingRuleHash?: string;
  extractedText?: string;
  confidence?: number;
  totalPages?: number;
  includedPages?: number;
}

describe('sweepFiledDocuments', () => {
  const invoices: CategoryFolder = {
    id: 'folder-invoices',
    name: '請求書',
    path: ['請求書'],
    parentId: 'root',
    description: 'YYYY-MM_発行元',
  };
  const contracts: CategoryFolder = {
    id: 'folder-contracts',
    name: '契約書',
    path: ['契約書'],
    parentId: 'root',
  };
  const tree = [invoices, contracts];

  const currentFingerprint = folderOrganizationFingerprint(
    tree,
    'folder-invoices'
  );
  const previousRuleHash = namingRuleHash('YYYYMMDD_発行元');

  const filed = (overrides: StoredDocument = {}): StoredDocument => ({
    fileId: 'file-123',
    fileName: 'scan.pdf',
    originalFileName: 'scan.pdf',
    renamedFileName: '20260115_ネコ商会.pdf',
    organizationFingerprint: 'stale-fingerprint',
    namingRuleHash: previousRuleHash,
    extractedText: '請求書 本文',
    confidence: 0.9,
    ...overrides,
  });

  let mockPublishMessage: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockWhere: jest.Mock;
  let mockSelect: jest.Mock;
  let documentsByFolder: Record<string, StoredDocument[]>;
  let callOrder: string[];

  const sweep = (limit = 50) =>
    sweepFiledDocuments({
      firestore: {
        collection: jest.fn().mockReturnValue({ where: mockWhere }),
      } as unknown as Firestore,
      topic: { publishMessage: mockPublishMessage } as unknown as Topic,
      auth: {} as DriveAuth,
      categoryFolders: tree,
      limit,
      batchId: 'batch-1',
    });

  beforeEach(() => {
    jest.clearAllMocks();

    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    require('./drive-operations').getFileState = mockGetFileState;

    callOrder = [];
    documentsByFolder = {};

    mockPublishMessage = jest.fn().mockImplementation(() => {
      callOrder.push('publish');
      return Promise.resolve('message-id');
    });
    mockUpdate = jest.fn().mockImplementation((fields: object) => {
      callOrder.push(`update:${Object.keys(fields).join(',')}`);
      return Promise.resolve();
    });

    mockSelect = jest.fn();
    mockWhere = jest
      .fn()
      .mockImplementation((_field: string, _op: string, folderId: string) => ({
        select: mockSelect.mockReturnValue({
          get: jest.fn().mockResolvedValue({
            docs: (documentsByFolder[folderId] ?? []).map((data, index) => ({
              id: `${folderId}-doc-${index}`,
              data: () => data,
              ref: {
                update: mockUpdate,
                get: jest.fn().mockResolvedValue({ data: () => data }),
              },
            })),
          }),
        }),
      }));

    mockGetFileState.mockResolvedValue({
      name: '20260115_ネコ商会.pdf',
      parents: ['folder-invoices'],
    });
  });

  it('should query each category folder for the documents filed in it', async () => {
    await sweep();

    expect(mockWhere).toHaveBeenCalledWith(
      'categoryFolderId',
      '==',
      'folder-invoices'
    );
    expect(mockWhere).toHaveBeenCalledWith(
      'categoryFolderId',
      '==',
      'folder-contracts'
    );
  });

  it('should leave the extracted text out of the triage query', async () => {
    await sweep();

    expect(mockSelect.mock.calls[0]).not.toContain('extractedText');
  });

  it("should republish a document whose folder's fingerprint has changed", async () => {
    documentsByFolder['folder-invoices'] = [
      filed({ totalPages: 12, includedPages: 5 }),
    ];

    const result = await sweep();

    expect(mockPublishMessage).toHaveBeenCalledWith({
      json: {
        firestoreDocId: 'folder-invoices-doc-0',
        fileId: 'file-123',
        fileName: 'scan.pdf',
        extractedText: '請求書 本文',
        confidence: 0.9,
        totalPages: 12,
        includedPages: 5,
        reorganization: true,
        reorganizationBatchId: 'batch-1',
        currentFolderId: 'folder-invoices',
        currentFileName: '20260115_ネコ商会.pdf',
        namingRuleHash: previousRuleHash,
      },
      attributes: { operation: 'file-reorganization', fileId: 'file-123' },
    });
    expect(result).toEqual({ candidates: 1, republished: 1, skipped: 0 });
  });

  it('should record the pending request before publishing and the fingerprint after', async () => {
    documentsByFolder['folder-invoices'] = [filed()];

    await sweep();

    expect(callOrder).toEqual([
      'update:reorganization',
      'publish',
      'update:organizationFingerprint',
    ]);
    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      reorganization: {
        batchId: 'batch-1',
        folderId: 'folder-invoices',
        folderPath: ['請求書'],
        requestedAt: expect.any(String),
        status: 'pending',
        reported: false,
      },
    });
    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      organizationFingerprint: currentFingerprint,
    });
  });

  it('should republish nothing and write nothing while the folder is unchanged', async () => {
    documentsByFolder['folder-invoices'] = [
      filed({ organizationFingerprint: currentFingerprint }),
    ];

    const result = await sweep();

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetFileState).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 0, republished: 0, skipped: 0 });
  });

  it("should adopt a document filed before fingerprints were recorded under the folder's current state", async () => {
    documentsByFolder['folder-invoices'] = [
      filed({ organizationFingerprint: undefined, namingRuleHash: undefined }),
    ];

    const result = await sweep();

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      organizationFingerprint: currentFingerprint,
      namingRuleHash: namingRuleHash('YYYY-MM_発行元'),
    });
    expect(result.republished).toBe(0);
  });

  it('should accept a file that still has its original name', async () => {
    documentsByFolder['folder-invoices'] = [filed({ renamedFileName: null })];
    mockGetFileState.mockResolvedValue({
      name: 'scan.pdf',
      parents: ['folder-invoices'],
    });

    const result = await sweep();

    expect(result.republished).toBe(1);
    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ currentFileName: 'scan.pdf' }),
      })
    );
  });

  describe('files the user has changed by hand', () => {
    const expectLeftAlone = async (): Promise<void> => {
      const result = await sweep();

      expect(mockPublishMessage).not.toHaveBeenCalled();
      // The fingerprint is still recorded, so the file is not looked at again
      // until the folder changes once more.
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        organizationFingerprint: currentFingerprint,
      });
      expect(result).toEqual({ candidates: 1, republished: 0, skipped: 1 });
    };

    beforeEach(() => {
      documentsByFolder['folder-invoices'] = [filed()];
    });

    it('should skip a file that was moved to another folder', async () => {
      mockGetFileState.mockResolvedValue({
        name: '20260115_ネコ商会.pdf',
        parents: ['some-other-folder'],
      });

      await expectLeftAlone();
    });

    it('should skip a file that was renamed', async () => {
      mockGetFileState.mockResolvedValue({
        name: '手で付けた名前.pdf',
        parents: ['folder-invoices'],
      });

      await expectLeftAlone();
    });

    it('should skip a file that no longer exists', async () => {
      mockGetFileState.mockResolvedValue(null);

      await expectLeftAlone();
    });
  });

  it('should skip a document without stored extracted text', async () => {
    documentsByFolder['folder-invoices'] = [filed({ extractedText: '' })];

    const result = await sweep();

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 1, republished: 0, skipped: 1 });
  });

  it('should stop at the limit and leave the rest for the next sweep', async () => {
    documentsByFolder['folder-invoices'] = [filed(), filed(), filed()];

    const result = await sweep(2);

    expect(result.republished).toBe(2);
    expect(mockPublishMessage).toHaveBeenCalledTimes(2);
    // The third document keeps its stale fingerprint.
    expect(
      mockUpdate.mock.calls.filter(
        ([fields]) => 'organizationFingerprint' in fields
      )
    ).toHaveLength(2);
  });

  it('should query nothing when the limit is already used up', async () => {
    documentsByFolder['folder-invoices'] = [filed()];

    const result = await sweep(0);

    expect(mockWhere).not.toHaveBeenCalled();
    expect(result.republished).toBe(0);
  });
});
