import { Firestore } from '@google-cloud/firestore';
import {
  CategoryFolder,
  DriveAuth,
  folderOrganizationFingerprint,
  namingRuleHash,
} from 'autonyan-shared';
import { reorganizeDocument, ReorganizationRequest } from './reorganization';

jest.mock('./classification');
jest.mock('./drive-operations');
jest.mock('./firestore-operations');
jest.mock('./rename');

const mockClassifyWithGemini = jest.fn();
const mockListFileNamesInFolder = jest.fn();
const mockMoveFileInDrive = jest.fn();
const mockRecordOrganizationHistory = jest.fn();
const mockRecordReorganizationOutcome = jest.fn();
const mockGenerateFileName = jest.fn();
const mockResolveRenamedFileName = jest.fn();

describe('reorganizeDocument', () => {
  const RULE = 'YYYY-MM_発行元';

  const invoices: CategoryFolder = {
    id: 'folder-invoices',
    name: '請求書',
    path: ['請求書'],
    parentId: 'root',
    description: RULE,
  };
  const acme: CategoryFolder = {
    id: 'folder-acme',
    name: '取引先A',
    path: ['請求書', '取引先A'],
    parentId: 'folder-invoices',
  };
  const globex: CategoryFolder = {
    id: 'folder-globex',
    name: '取引先B',
    path: ['請求書', '取引先B'],
    parentId: 'folder-invoices',
    description: 'YYYYMMDD_番号',
  };
  const contracts: CategoryFolder = {
    id: 'folder-contracts',
    name: '契約書',
    path: ['契約書'],
    parentId: 'root',
  };

  const flatTree = [invoices, contracts];
  const nestedTree = [invoices, acme, globex, contracts];

  const auth = { mockDriveAuth: true } as unknown as DriveAuth;
  const firestore = {} as Firestore;

  const request = (
    overrides: Partial<ReorganizationRequest> = {}
  ): ReorganizationRequest => ({
    firestoreDocId: 'doc123',
    fileId: 'file-123',
    fileName: 'scan.pdf',
    extractedText: '請求書 本文',
    reorganizationBatchId: 'batch-1',
    currentFolderId: 'folder-invoices',
    currentFileName: '20260115_ネコ商会.pdf',
    namingRuleHash: namingRuleHash(RULE),
    ...overrides,
  });

  const run = (
    categoryFolders: CategoryFolder[],
    overrides: Partial<ReorganizationRequest> = {}
  ) =>
    reorganizeDocument(
      { projectId: 'test-project', auth, firestore, categoryFolders },
      request(overrides)
    );

  const classifiedInto = (folder: CategoryFolder | null): void => {
    mockClassifyWithGemini.mockResolvedValue({
      categoryName: folder?.path[0] ?? null,
      categoryPath: folder?.path ?? null,
      categoryFolderId: folder?.id ?? null,
      confidence: 0.9,
      reasoning: '理由',
      summary: '要約',
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    /* eslint-disable @typescript-eslint/no-require-imports, no-undef */
    require('./classification').classifyWithGemini = mockClassifyWithGemini;
    const driveOps = require('./drive-operations');
    driveOps.listFileNamesInFolder = mockListFileNamesInFolder;
    driveOps.moveFileInDrive = mockMoveFileInDrive;
    const firestoreOps = require('./firestore-operations');
    firestoreOps.recordOrganizationHistory = mockRecordOrganizationHistory;
    firestoreOps.recordReorganizationOutcome = mockRecordReorganizationOutcome;
    const rename = require('./rename');
    rename.generateFileName = mockGenerateFileName;
    rename.resolveRenamedFileName = mockResolveRenamedFileName;
    /* eslint-enable @typescript-eslint/no-require-imports, no-undef */

    mockListFileNamesInFolder.mockResolvedValue(['2026-02_イヌ商事.pdf']);
    mockGenerateFileName.mockResolvedValue({
      fileName: '2026-01_ネコ商会',
      confidence: 0.9,
      reasoning: '命名規則に合わせました',
    });
    mockResolveRenamedFileName.mockReturnValue('2026-01_ネコ商会.pdf');
    mockMoveFileInDrive.mockResolvedValue(undefined);
    mockRecordOrganizationHistory.mockResolvedValue(undefined);
    mockRecordReorganizationOutcome.mockResolvedValue(undefined);
  });

  describe('when the naming rule changed', () => {
    const staleRule = { namingRuleHash: namingRuleHash('YYYYMMDD_発行元') };

    it('should rename the file under the current rule without moving it', async () => {
      const outcome = await run(flatTree, staleRule);

      expect(mockGenerateFileName).toHaveBeenCalledWith(
        'test-project',
        '請求書 本文',
        'scan.pdf',
        ['2026-02_イヌ商事.pdf'],
        { pageInfo: undefined, namingRule: RULE }
      );
      // Compared against the name the file has now, not the one it had at
      // ingestion, so regenerating the same name is not a rename.
      expect(mockResolveRenamedFileName).toHaveBeenCalledWith(
        expect.any(Object),
        'scan.pdf',
        ['2026-02_イヌ商事.pdf'],
        '20260115_ネコ商会.pdf'
      );
      expect(mockMoveFileInDrive).toHaveBeenCalledWith(
        auth,
        'file-123',
        'folder-invoices',
        '2026-01_ネコ商会.pdf'
      );
      expect(outcome).toEqual({
        status: 'changed',
        previousFileName: '20260115_ネコ商会.pdf',
        newFileName: '2026-01_ネコ商会.pdf',
        namingRuleHash: namingRuleHash(RULE),
      });
      expect(mockRecordReorganizationOutcome).toHaveBeenCalledWith(
        firestore,
        'extracted_texts/doc123',
        outcome
      );
    });

    it('should make no classification call for a folder without subfolders', async () => {
      await run(flatTree, staleRule);

      expect(mockClassifyWithGemini).not.toHaveBeenCalled();
    });

    it('should record the previous name and folder before touching Drive', async () => {
      const order: string[] = [];
      mockRecordOrganizationHistory.mockImplementation(() => {
        order.push('history');
        return Promise.resolve();
      });
      mockMoveFileInDrive.mockImplementation(() => {
        order.push('drive');
        return Promise.resolve();
      });

      await run(flatTree, staleRule);

      expect(order).toEqual(['history', 'drive']);
      expect(mockRecordOrganizationHistory).toHaveBeenCalledWith(
        firestore,
        'extracted_texts/doc123',
        {
          fileName: '20260115_ネコ商会.pdf',
          folderId: 'folder-invoices',
          reorganizationBatchId: 'batch-1',
        }
      );
    });

    it('should write nothing to Drive when the guards keep the current name', async () => {
      mockResolveRenamedFileName.mockReturnValue(null);

      const outcome = await run(flatTree, staleRule);

      expect(mockMoveFileInDrive).not.toHaveBeenCalled();
      expect(mockRecordOrganizationHistory).not.toHaveBeenCalled();
      // The rule the name was checked against is still recorded, so a later
      // change to the subfolders does not reopen the rename.
      expect(outcome).toEqual({
        status: 'unchanged',
        previousFileName: '20260115_ネコ商会.pdf',
        namingRuleHash: namingRuleHash(RULE),
      });
    });

    it('should let a name generation failure propagate so the message is retried', async () => {
      mockGenerateFileName.mockRejectedValue(new Error('Vertex unavailable'));

      await expect(run(flatTree, staleRule)).rejects.toThrow(
        'Vertex unavailable'
      );
      expect(mockMoveFileInDrive).not.toHaveBeenCalled();
    });
  });

  describe('when a subfolder was added', () => {
    it("should offer only the document's own folder and the folders below it", async () => {
      classifiedInto(invoices);

      await run(nestedTree);

      expect(mockClassifyWithGemini).toHaveBeenCalledWith(
        'test-project',
        '請求書 本文',
        [invoices, acme, globex],
        undefined
      );
    });

    it('should move a matching document into the subfolder and keep its name under an inherited rule', async () => {
      classifiedInto(acme);

      const outcome = await run(nestedTree);

      expect(mockGenerateFileName).not.toHaveBeenCalled();
      expect(mockMoveFileInDrive).toHaveBeenCalledWith(
        auth,
        'file-123',
        'folder-acme',
        undefined
      );
      expect(outcome).toEqual({
        status: 'changed',
        previousFileName: '20260115_ネコ商会.pdf',
        newFolder: {
          id: 'folder-acme',
          path: ['請求書', '取引先A'],
          organizationFingerprint: folderOrganizationFingerprint(
            nestedTree,
            'folder-acme'
          ),
        },
      });
    });

    it('should move and rename in one call when the subfolder has a rule of its own', async () => {
      classifiedInto(globex);

      const outcome = await run(nestedTree);

      expect(mockListFileNamesInFolder).toHaveBeenCalledWith(
        auth,
        'folder-globex',
        'file-123'
      );
      expect(mockGenerateFileName).toHaveBeenCalledWith(
        'test-project',
        '請求書 本文',
        'scan.pdf',
        ['2026-02_イヌ商事.pdf'],
        { pageInfo: undefined, namingRule: 'YYYYMMDD_番号' }
      );
      expect(mockMoveFileInDrive).toHaveBeenCalledTimes(1);
      expect(mockMoveFileInDrive).toHaveBeenCalledWith(
        auth,
        'file-123',
        'folder-globex',
        '2026-01_ネコ商会.pdf'
      );
      expect(outcome).toMatchObject({
        status: 'changed',
        newFileName: '2026-01_ネコ商会.pdf',
        newFolder: { id: 'folder-globex' },
        namingRuleHash: namingRuleHash('YYYYMMDD_番号'),
      });
    });

    it('should leave a document that fits no subfolder untouched', async () => {
      classifiedInto(invoices);

      const outcome = await run(nestedTree);

      expect(mockMoveFileInDrive).not.toHaveBeenCalled();
      expect(mockGenerateFileName).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        status: 'unchanged',
        previousFileName: '20260115_ネコ商会.pdf',
      });
    });

    it('should never send a filed document back to Uncategorized', async () => {
      classifiedInto(null);

      const outcome = await run(nestedTree);

      expect(mockMoveFileInDrive).not.toHaveBeenCalled();
      expect(outcome.status).toBe('unchanged');
    });
  });

  it('should not rename a document whose naming rule hash was never recorded', async () => {
    const outcome = await run(flatTree, { namingRuleHash: undefined });

    expect(mockGenerateFileName).not.toHaveBeenCalled();
    expect(outcome.status).toBe('unchanged');
  });

  it('should leave the file alone when its folder is no longer a category', async () => {
    const outcome = await run([contracts]);

    expect(mockClassifyWithGemini).not.toHaveBeenCalled();
    expect(mockMoveFileInDrive).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'unchanged',
      previousFileName: '20260115_ネコ商会.pdf',
    });
  });

  it('should record a failed outcome without throwing when Drive rejects the change', async () => {
    mockMoveFileInDrive.mockRejectedValue(
      new Error('insufficient permissions for this file')
    );

    const outcome = await run(flatTree, {
      namingRuleHash: namingRuleHash('YYYYMMDD_発行元'),
    });

    expect(outcome).toEqual({
      status: 'failed',
      previousFileName: '20260115_ネコ商会.pdf',
      error: 'insufficient permissions for this file',
    });
    expect(mockRecordReorganizationOutcome).toHaveBeenCalledWith(
      firestore,
      'extracted_texts/doc123',
      outcome
    );
  });
});
