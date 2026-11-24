import { FieldValue, Firestore } from '@google-cloud/firestore';
import {
  recordOrganizationHistory,
  recordReorganizationOutcome,
  updateDocumentWithClassification,
} from './firestore-operations';

describe('firestore-operations', () => {
  const mockUpdate = jest.fn();
  const mockDoc = jest.fn();
  const firestore = { doc: mockDoc } as unknown as Firestore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ update: mockUpdate });
  });

  describe('updateDocumentWithClassification', () => {
    it('should store the organization state next to the classification', async () => {
      await updateDocumentWithClassification(
        firestore,
        'extracted_texts/doc123',
        {
          category: '請求書',
          categoryPath: ['請求書'],
          categoryFolderId: 'folder-invoices',
          categoryFolderSetHash: 'folder-set-hash',
          organizationFingerprint: 'fingerprint',
          namingRuleHash: 'rule-hash',
          classificationConfidence: 0.95,
          classificationReasoning: '理由',
          classifiedAt: '2026-01-15T00:00:00.000Z',
          summary: '要約',
          originalFileName: 'scan.pdf',
          renamedFileName: null,
          renameConfidence: null,
          renameReasoning: null,
        }
      );

      expect(mockDoc).toHaveBeenCalledWith('extracted_texts/doc123');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryFolderId: 'folder-invoices',
          organizationFingerprint: 'fingerprint',
          namingRuleHash: 'rule-hash',
        })
      );
    });
  });

  describe('recordOrganizationHistory', () => {
    it('should append the entry without replacing earlier ones', async () => {
      const entry = {
        fileName: 'old.pdf',
        folderId: 'folder-invoices',
        reorganizationBatchId: 'batch-1',
      };

      await recordOrganizationHistory(
        firestore,
        'extracted_texts/doc123',
        entry
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        organizationHistory: FieldValue.arrayUnion(entry),
      });
    });
  });

  describe('recordReorganizationOutcome', () => {
    it('should record a rename and bring the stored name in line', async () => {
      await recordReorganizationOutcome(firestore, 'extracted_texts/doc123', {
        status: 'changed',
        previousFileName: 'old.pdf',
        newFileName: 'new.pdf',
        namingRuleHash: 'rule-hash',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        'reorganization.status': 'changed',
        'reorganization.completedAt': expect.any(String),
        'reorganization.previousFileName': 'old.pdf',
        'reorganization.newFileName': 'new.pdf',
        renamedFileName: 'new.pdf',
        namingRuleHash: 'rule-hash',
      });
    });

    it('should record a move and bring the stored folder in line', async () => {
      await recordReorganizationOutcome(firestore, 'extracted_texts/doc123', {
        status: 'changed',
        previousFileName: 'old.pdf',
        newFolder: {
          id: 'folder-acme',
          path: ['請求書', '取引先A'],
          organizationFingerprint: 'subfolder-fingerprint',
        },
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        'reorganization.status': 'changed',
        'reorganization.completedAt': expect.any(String),
        'reorganization.previousFileName': 'old.pdf',
        'reorganization.newFolderId': 'folder-acme',
        'reorganization.newFolderPath': ['請求書', '取引先A'],
        categoryFolderId: 'folder-acme',
        categoryPath: ['請求書', '取引先A'],
        organizationFingerprint: 'subfolder-fingerprint',
      });
    });

    it('should leave the stored name and folder alone when nothing changed', async () => {
      await recordReorganizationOutcome(firestore, 'extracted_texts/doc123', {
        status: 'unchanged',
        previousFileName: 'old.pdf',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        'reorganization.status': 'unchanged',
        'reorganization.completedAt': expect.any(String),
        'reorganization.previousFileName': 'old.pdf',
      });
    });

    it('should record the error of a failed change', async () => {
      await recordReorganizationOutcome(firestore, 'extracted_texts/doc123', {
        status: 'failed',
        previousFileName: 'old.pdf',
        error: 'insufficient permissions',
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          'reorganization.status': 'failed',
          'reorganization.error': 'insufficient permissions',
        })
      );
    });
  });
});
