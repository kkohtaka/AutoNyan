import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { google } from 'googleapis';
import { drive_v3 } from 'googleapis';
import { createHash } from 'crypto';
import * as fs from 'fs';

import { authenticateE2E } from './helpers/auth';
import {
  uploadTestFile,
  cleanupDriveFiles,
  createTestFolder,
} from './helpers/drive-setup';
import {
  pollForStorageObject,
  pollForFirestoreDocument,
} from './helpers/polling';
import { cleanupTestResources } from './helpers/cleanup';
import { getTerraformOutputs } from './helpers/terraform-outputs';
import { E2ELogger } from './helpers/logger';

describe('AutoNyan E2E - Full Pipeline', () => {
  let pubsub: PubSub;
  let storage: Storage;
  let firestore: Firestore;
  let drive: drive_v3.Drive;

  let testFolderId: string;
  let testFileId: string;
  let testFileName: string;
  let contentHash: string;
  let categoryRootFolderId: string;
  let categoryFolderId: string; // Test category folder (e.g., "請求書")

  const logger = new E2ELogger('full-pipeline');
  const TEST_TIMEOUT = 600000; // 10 minutes for full pipeline
  const testStartTime = new Date();

  beforeAll(async () => {
    logger.log('setup', 'Starting E2E test setup');

    // Authenticate with GCP
    await authenticateE2E();

    // Initialize GCP clients
    pubsub = new PubSub();
    storage = new Storage();
    firestore = new Firestore();

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    drive = google.drive({ version: 'v3', auth });

    // Get Terraform outputs for staging environment
    const outputs = await getTerraformOutputs('staging');
    testFolderId = outputs.drive_folder_id;
    categoryRootFolderId = outputs.category_root_folder_id;

    // Create test category folder for classification
    logger.log('setup', 'Creating test category folder');
    categoryFolderId = await createTestFolder(
      drive,
      categoryRootFolderId,
      '請求書'
    );
    logger.log('setup', 'Test category folder created', {
      categoryFolderId,
      categoryName: '請求書',
    });

    logger.log('setup', 'E2E test setup complete', {
      projectId: process.env.PROJECT_ID,
      environment: process.env.ENVIRONMENT,
      folderId: testFolderId,
      categoryRootFolderId,
      categoryFolderId,
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    logger.log('teardown', 'Cleaning up test resources');

    // Cleanup test resources
    await cleanupTestResources({
      drive,
      storage,
      firestore,
      testFolderId,
      testFileId,
      contentHash,
    });

    // Cleanup test category folder
    if (categoryFolderId) {
      try {
        await drive.files.delete({ fileId: categoryFolderId });
        logger.log('teardown', 'Test category folder deleted', {
          categoryFolderId,
        });
      } catch (error) {
        logger.log(
          'teardown',
          'Failed to delete test category folder (may not exist)',
          { error }
        );
      }
    }

    logger.log('teardown', 'Cleanup complete');
  }, TEST_TIMEOUT);

  it(
    'should process a document through all 5 pipeline stages',
    async () => {
      try {
        // ========================================
        // Stage 1: Upload test file to Drive and trigger scanner
        // ========================================
        logger.log('stage-1', 'Uploading test file to Google Drive');

        const testFile = await uploadTestFile(
          drive,
          testFolderId,
          './tests/e2e/fixtures/sample-documents/test-document.txt'
        );
        testFileId = testFile.id!;
        testFileName = testFile.name!;

        logger.log('stage-1', 'Test file uploaded', {
          fileId: testFileId,
          fileName: testFileName,
        });

        // Trigger Drive Scanner via PubSub
        const outputs = await getTerraformOutputs('staging');
        const topic = pubsub.topic(outputs.drive_scan_trigger_topic);

        logger.log('stage-1', 'Publishing PubSub message to trigger scanner', {
          topic: outputs.drive_scan_trigger_topic,
          folderId: testFolderId,
        });

        await topic.publishMessage({
          data: Buffer.from(JSON.stringify({ folderId: testFolderId })),
        });

        logger.log('stage-1', 'Drive Scanner triggered successfully');

        // ========================================
        // Stage 2: Wait for Doc Processor to upload to Storage
        // ========================================
        logger.log('stage-2', 'Waiting for Doc Processor to process file');

        const documentBucket = outputs.document_storage_bucket;
        const docObject = await pollForStorageObject(
          storage,
          documentBucket,
          (fileName) => fileName.startsWith('documents/'),
          { timeout: 120000, interval: 5000 }
        );

        expect(docObject).toBeDefined();
        expect(docObject!.metadata?.originalFileId).toBe(testFileId);
        contentHash = String(docObject!.metadata?.contentHash || '');

        logger.log('stage-2', 'Doc Processor completed', {
          objectName: docObject!.name,
          contentHash,
          size: docObject!.size,
        });

        // ========================================
        // Stage 3: Wait for Vision API processing
        // ========================================
        logger.log('stage-3', 'Waiting for Vision API text extraction');

        const visionBucket = outputs.vision_results_bucket;
        const visionResult = await pollForStorageObject(
          storage,
          visionBucket,
          (fileName) =>
            fileName.includes(contentHash) && fileName.endsWith('.json'),
          { timeout: 300000, interval: 10000 } // 5 minutes for Vision API
        );

        expect(visionResult).toBeDefined();

        logger.log('stage-3', 'Vision API processing completed', {
          resultFile: visionResult!.name,
        });

        // ========================================
        // Stage 4: Wait for Firestore document creation
        // ========================================
        logger.log('stage-4', 'Waiting for Firebase Writer to store results');

        const firestoreDoc = await pollForFirestoreDocument(
          firestore,
          'extracted_texts',
          (doc) => doc.fileId === testFileId,
          { timeout: 60000, interval: 5000 }
        );

        expect(firestoreDoc).toBeDefined();
        expect(firestoreDoc!.extractedText).toBeTruthy();
        expect(firestoreDoc!.confidence).toBeGreaterThan(0);
        expect(firestoreDoc!.fileName).toContain('e2e-test');

        logger.log('stage-4', 'Firebase Writer completed', {
          firestoreDocId: firestoreDoc!.fileId,
          textLength: firestoreDoc!.extractedText?.length || 0,
          confidence: firestoreDoc!.confidence,
          pages: firestoreDoc!.pages,
        });

        // ========================================
        // Stage 5: Wait for file classification and Drive movement
        // ========================================
        logger.log('stage-5', 'Waiting for File Classifier to categorize file');

        // Allow time for Firestore trigger to fire
        await new Promise((resolve) => setTimeout(resolve, 30000));

        const classifiedDoc = await pollForFirestoreDocument(
          firestore,
          'extracted_texts',
          (doc) => doc.fileId === testFileId && doc.category !== undefined,
          { timeout: 120000, interval: 10000 }
        );

        expect(classifiedDoc).toBeDefined();
        expect(classifiedDoc!.category).toBeDefined();
        expect(classifiedDoc!.classificationConfidence).toBeGreaterThan(0);

        logger.log('stage-5', 'File Classifier completed', {
          category: classifiedDoc!.category,
          confidence: classifiedDoc!.classificationConfidence,
          reasoning: classifiedDoc!.classificationReasoning,
        });

        // Verify file was moved in Drive
        const fileMetadata = await drive.files.get({
          fileId: testFileId,
          fields: 'parents',
        });

        const expectedFolderId = classifiedDoc!.category
          ? classifiedDoc!.categoryFolderId
          : outputs.uncategorized_folder_id;

        expect(fileMetadata.data.parents).toContain(expectedFolderId);

        logger.log('stage-5', 'File successfully moved in Drive', {
          newParentFolder: expectedFolderId,
        });

        // ========================================
        // Test Completion
        // ========================================
        logger.log('success', 'Full pipeline E2E test completed successfully', {
          duration: `${Date.now() - testStartTime.getTime()}ms`,
          stages: 5,
        });
      } catch (error) {
        logger.error('failure', error as Error, {
          testFileId,
          contentHash,
          testStartTime,
        });

        // Re-throw to fail the test
        throw error;
      }
    },
    TEST_TIMEOUT
  );
});
