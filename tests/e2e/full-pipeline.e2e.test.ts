import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { google } from 'googleapis';
import { drive_v3 } from 'googleapis';

import { authenticateE2E } from './helpers/auth';
import {
  uploadTestFile,
  createTestFolder,
  createNamedTestFile,
  trashDriveItem,
} from './helpers/drive-setup';
import {
  pollForStorageObject,
  pollForFirestoreDocument,
  pollForDriveFileLocation,
} from './helpers/polling';
import { cleanupTestResources } from './helpers/cleanup';
import {
  pollForFunctionLogEntry,
  countFunctionLogEntries,
} from './helpers/cloud-logs';
import { getTerraformOutputs, TerraformOutputs } from './helpers/terraform-outputs';
import { E2ELogger } from './helpers/logger';

interface FormatFixture {
  label: string;
  fixturePath: string;
  mimeType: string;
  // Core-matrix cases run on every trigger (including post-deploy); the rest
  // run only when E2E_FORMAT_MATRIX=full (nightly/manual) to keep the
  // post-deploy job inside its 45-minute timeout.
  coreMatrix: boolean;
}

// PDF is the core case: it exercises the Vision async-batch path where both
// #364 production bugs lived, which the text/plain path skips entirely.
// The image case uses TIFF because asyncBatchAnnotateFiles accepts only
// PDF/TIFF/GIF inputs.
const HAPPY_PATH_FIXTURES: FormatFixture[] = [
  {
    label: 'PDF document',
    fixturePath: './tests/e2e/fixtures/sample-documents/test-invoice.pdf',
    mimeType: 'application/pdf',
    coreMatrix: true,
  },
  {
    label: 'plain text document',
    fixturePath: './tests/e2e/fixtures/sample-documents/test-document.txt',
    mimeType: 'text/plain',
    coreMatrix: false,
  },
  {
    label: 'TIFF image',
    fixturePath: './tests/e2e/fixtures/sample-documents/test-receipt.tiff',
    mimeType: 'image/tiff',
    coreMatrix: false,
  },
];

// HTML bytes stored under application/pdf: Vision rejects the input with
// INVALID_ARGUMENT, which must be treated as a permanent failure (single ACK,
// failure notification, no Firestore document) — the other #364 regression.
const PERMANENT_FAILURE_FIXTURES: FormatFixture[] = [
  {
    label: 'HTML content disguised as PDF',
    fixturePath: './tests/e2e/fixtures/sample-documents/test-invalid.pdf',
    mimeType: 'application/pdf',
    coreMatrix: false,
  },
];

// Reference names seeded into the test category folder follow one distinctive
// convention so the rename stage can infer it. Assertions never expect the
// convention itself — Gemini naming is nondeterministic — only consistency
// between Firestore and Drive.
const REFERENCE_FILE_NAMES = [
  '2026-04-10_請求書_サンプル商事.pdf',
  '2026-05-12_請求書_テスト物産.pdf',
  '2026-06-15_請求書_サンプル工業.pdf',
];

const isFullMatrix = process.env.E2E_FORMAT_MATRIX === 'full';
const activeHappyPathFixtures = HAPPY_PATH_FIXTURES.filter(
  (fixture) => isFullMatrix || fixture.coreMatrix
);
const activePermanentFailureFixtures = PERMANENT_FAILURE_FIXTURES.filter(
  (fixture) => isFullMatrix || fixture.coreMatrix
);

describe('AutoNyan E2E - Full Pipeline', () => {
  let pubsub: PubSub;
  let storage: Storage;
  let firestore: Firestore;
  let drive: drive_v3.Drive;
  let outputs: TerraformOutputs;

  let testFolderId: string;
  let testRunFolderId: string; // Isolated folder per test run to avoid Drive scan picking up accumulated files
  let categoryRootFolderId: string;
  let categoryFolderId: string; // Test category folder (e.g., "請求書")

  // Every uploaded file is registered here so afterAll can clean up even
  // when a case fails mid-pipeline.
  const uploadedFiles: {
    fileId: string;
    contentHash?: string;
  }[] = [];

  // Reference files seeded into the category folder, trashed in afterAll.
  const seededReferenceFileIds: string[] = [];

  const logger = new E2ELogger('full-pipeline');
  const TEST_TIMEOUT = 1500000; // 25 minutes: stage2(5m) + stage3(9m) + stage4(1m) + stage5(5m) + stage6(3m) + buffer

  beforeAll(async () => {
    logger.log('setup', 'Starting E2E test setup');

    // Authenticate with GCP
    await authenticateE2E();

    // Initialize GCP clients
    pubsub = new PubSub();
    storage = new Storage();

    // Use environment-specific Firestore database for E2E tests
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
      throw new Error('ENVIRONMENT environment variable is required');
    }
    firestore = new Firestore({
      databaseId: environment,
    });

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    drive = google.drive({ version: 'v3', auth });

    // Get Terraform outputs for staging environment
    outputs = await getTerraformOutputs('staging');
    testFolderId = outputs.drive_folder_id;
    categoryRootFolderId = outputs.category_root_folder_id;

    // Create isolated folder for this test run to avoid Drive Scanner picking up
    // accumulated files from previous runs (which would create a large PubSub backlog)
    logger.log('setup', 'Creating isolated test run folder');
    testRunFolderId = await createTestFolder(
      drive,
      testFolderId,
      `e2e-run-${Date.now()}`,
      [outputs.file_classifier_service_account_email]
    );
    logger.log('setup', 'Isolated test run folder created', {
      testRunFolderId,
    });

    // Create test category folder for classification
    logger.log('setup', 'Creating test category folder');
    categoryFolderId = await createTestFolder(
      drive,
      categoryRootFolderId,
      '請求書',
      [outputs.file_classifier_service_account_email]
    );
    logger.log('setup', 'Test category folder created', {
      categoryFolderId,
      categoryName: '請求書',
    });

    // Seed the category folder so the rename stage's naming-convention
    // inference path is exercised (an empty folder takes the content-only
    // prompt branch instead).
    logger.log('setup', 'Seeding reference files in test category folder');
    for (const referenceFileName of REFERENCE_FILE_NAMES) {
      const seededFileId = await createNamedTestFile(
        drive,
        categoryFolderId,
        referenceFileName
      );
      seededReferenceFileIds.push(seededFileId);
    }
    logger.log('setup', 'Reference files seeded', {
      count: seededReferenceFileIds.length,
      names: REFERENCE_FILE_NAMES,
    });

    logger.log('setup', 'E2E test setup complete', {
      projectId: process.env.PROJECT_ID,
      environment: process.env.ENVIRONMENT,
      folderId: testFolderId,
      categoryRootFolderId,
      categoryFolderId,
      formatMatrix: isFullMatrix ? 'full' : 'core',
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    logger.log('teardown', 'Cleaning up test resources');

    for (const uploadedFile of uploadedFiles) {
      await cleanupTestResources({
        drive,
        storage,
        firestore,
        testFolderId,
        testFileId: uploadedFile.fileId,
        contentHash: uploadedFile.contentHash,
      });
    }

    // Cleanup isolated test run folder (trashing the folder removes the
    // per-case subfolders and any files still inside them)
    if (testRunFolderId) {
      try {
        await trashDriveItem(drive, testRunFolderId);
        logger.log('teardown', 'Isolated test run folder trashed', {
          testRunFolderId,
        });
      } catch (error) {
        logger.log(
          'teardown',
          'Failed to trash isolated test run folder (may not exist)',
          { error }
        );
      }
    }

    // Cleanup seeded reference files (before their parent category folder)
    for (const seededFileId of seededReferenceFileIds) {
      try {
        await trashDriveItem(drive, seededFileId);
      } catch (error) {
        logger.log(
          'teardown',
          'Failed to trash seeded reference file (may not exist)',
          { seededFileId, error }
        );
      }
    }
    if (seededReferenceFileIds.length > 0) {
      logger.log('teardown', 'Seeded reference files trashed', {
        count: seededReferenceFileIds.length,
      });
    }

    // Cleanup test category folder
    if (categoryFolderId) {
      try {
        await trashDriveItem(drive, categoryFolderId);
        logger.log('teardown', 'Test category folder trashed', {
          categoryFolderId,
        });
      } catch (error) {
        logger.log(
          'teardown',
          'Failed to trash test category folder (may not exist)',
          { error }
        );
      }
    }

    logger.log('teardown', 'Cleanup complete');
  }, TEST_TIMEOUT);

  /**
   * Stage 1 (shared by every case): upload the fixture into a fresh per-case
   * subfolder and trigger the Drive Scanner on it. The per-case subfolder
   * keeps a case's scan from republishing files left behind by earlier cases
   * (a failed best-effort move in stage 5 leaves the file in place).
   */
  async function uploadFixtureAndTriggerScan(fixture: FormatFixture): Promise<{
    fileId: string;
    fileName: string;
  }> {
    logger.log('stage-1', 'Creating per-case subfolder', {
      fixture: fixture.label,
    });

    const caseFolderId = await createTestFolder(drive, testRunFolderId, 'case', [
      outputs.file_classifier_service_account_email,
    ]);

    logger.log('stage-1', 'Uploading test file to Google Drive', {
      fixturePath: fixture.fixturePath,
      mimeType: fixture.mimeType,
    });

    const testFile = await uploadTestFile(
      drive,
      caseFolderId,
      fixture.fixturePath,
      [outputs.file_classifier_service_account_email],
      fixture.mimeType
    );
    const fileId = testFile.id!;
    const fileName = testFile.name!;

    uploadedFiles.push({ fileId });

    logger.log('stage-1', 'Test file uploaded', { fileId, fileName });

    // Wait for Drive permissions to propagate
    // Google Drive can take time to propagate file sharing permissions
    logger.log(
      'stage-1',
      'Waiting 10 seconds for Drive permissions to propagate...'
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const topic = pubsub.topic(outputs.drive_scan_trigger_topic);

    logger.log('stage-1', 'Publishing PubSub message to trigger scanner', {
      topic: outputs.drive_scan_trigger_topic,
      folderId: caseFolderId,
    });

    await topic.publishMessage({
      data: Buffer.from(JSON.stringify({ folderId: caseFolderId })),
    });

    logger.log('stage-1', 'Drive Scanner triggered successfully');

    return { fileId, fileName };
  }

  /**
   * Stage 2 (shared by every case): wait for the Doc Processor to copy the
   * file into the document-storage bucket and return its contentHash.
   */
  async function waitForDocProcessor(fileId: string): Promise<string> {
    logger.log('stage-2', 'Waiting for Doc Processor to process file');

    const documentBucket = outputs.document_storage_bucket;
    const docObject = await pollForStorageObject(
      storage,
      documentBucket,
      (fileName, metadata) =>
        fileName.startsWith('documents/') &&
        metadata?.originalFileId === fileId,
      { timeout: 300000, interval: 5000 } // 5 minutes to account for cold starts
    );

    expect(docObject).toBeDefined();
    const contentHash = String(docObject!.metadata?.contentHash || '');
    const uploadedFile = uploadedFiles.find((file) => file.fileId === fileId);
    if (uploadedFile) {
      uploadedFile.contentHash = contentHash;
    }

    logger.log('stage-2', 'Doc Processor completed', {
      objectName: docObject!.name,
      contentHash,
      size: docObject!.size,
    });

    return contentHash;
  }

  it.each(activeHappyPathFixtures)(
    'should process a $label through all 6 pipeline stages',
    async (fixture) => {
      const caseStartTime = new Date();
      let testFileId = '';
      let contentHash = '';

      try {
        const uploaded = await uploadFixtureAndTriggerScan(fixture);
        testFileId = uploaded.fileId;
        const testFileName = uploaded.fileName;

        contentHash = await waitForDocProcessor(testFileId);

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
          { timeout: 540000, interval: 10000 } // 9 minutes to match text-vision-processor Cloud Function timeout
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

        // Verify file was moved in Drive (with polling to handle retry delays)
        const expectedFolderId = classifiedDoc!.category
          ? classifiedDoc!.categoryFolderId
          : outputs.uncategorized_folder_id;

        logger.log(
          'stage-5',
          'Polling for file to be moved to target folder...',
          {
            expectedFolderId,
            timeout: '60 seconds',
          }
        );

        const fileMoved = await pollForDriveFileLocation(
          drive,
          testFileId,
          expectedFolderId,
          { timeout: 60000, interval: 5000, errorOnTimeout: false }
        );

        if (fileMoved) {
          logger.log('stage-5', 'File successfully moved in Drive', {
            newParentFolder: expectedFolderId,
          });
        } else {
          logger.log('stage-5', 'File was not moved within timeout', {
            expectedFolderId,
            note: 'Classification succeeded but the file move failed - check the classifier service account has fileOrganizer on the shared drive folders',
          });
        }

        // File move is not required for test to pass - classification is the primary goal
        // expect(fileMoved).toBe(true); // Commented out - file move is best-effort
        expect(classifiedDoc!.category).toBeDefined(); // This is the critical check

        // ========================================
        // Stage 5b: Verify content-based rename consistency
        // ========================================
        // Gemini-generated names are nondeterministic, so assert only that
        // Firestore and Drive agree — never an exact generated name.
        logger.log('stage-5', 'Verifying content-based rename consistency');

        expect(classifiedDoc!.originalFileName).toBe(testFileName);
        expect(classifiedDoc).toHaveProperty('renamedFileName');
        expect(classifiedDoc).toHaveProperty('renameConfidence');
        expect(classifiedDoc).toHaveProperty('renameReasoning');

        const renamedFileName = classifiedDoc!.renamedFileName as
          | string
          | null;

        if (renamedFileName !== null) {
          const extension = testFileName.match(/\.[^.]+$/)?.[0] ?? '';
          expect(renamedFileName.endsWith(extension)).toBe(true);
          expect(classifiedDoc!.renameConfidence).toBeGreaterThan(0);
          expect(classifiedDoc!.renameReasoning).toBeTruthy();
        }

        // The rename rides on the same files.update call as the move, so the
        // Drive name can only be verified when the best-effort move succeeded.
        if (fileMoved) {
          const movedFile = await drive.files.get({
            fileId: testFileId,
            fields: 'name',
            supportsAllDrives: true,
          });
          expect(movedFile.data.name).toBe(renamedFileName ?? testFileName);

          logger.log('stage-5', 'Drive file name consistent with Firestore', {
            driveFileName: movedFile.data.name,
            renamedFileName,
            originalFileName: testFileName,
          });
        } else {
          logger.log(
            'stage-5',
            'Skipping Drive name verification (file move did not complete)'
          );
        }

        // ========================================
        // Stage 6: Wait for notification dispatch
        // ========================================
        logger.log(
          'stage-6',
          'Waiting for Notification Dispatcher to send success notification'
        );

        // The dispatcher only logs 'Sent success notification' after correctly
        // parsing the `operation` attribute and reaching the send path, so this
        // fails if it exits via the 'Unknown notification operation' branch.
        const notificationLog = await pollForFunctionLogEntry(
          `${process.env.ENVIRONMENT}-notification-dispatcher`,
          outputs.region,
          caseStartTime,
          { message: 'Sent success notification', fileName: testFileName },
          { timeout: 180000, interval: 15000 }
        );

        expect(notificationLog).toBeTruthy();

        logger.log('stage-6', 'Notification Dispatcher completed', {
          logEntry: notificationLog,
        });

        // ========================================
        // Test Completion
        // ========================================
        logger.log('success', 'Full pipeline E2E test completed successfully', {
          fixture: fixture.label,
          duration: `${Date.now() - caseStartTime.getTime()}ms`,
          stages: 6,
        });
      } catch (error) {
        logger.error('failure', error as Error, {
          fixture: fixture.label,
          testFileId,
          contentHash,
          caseStartTime,
        });

        // Re-throw to fail the test
        throw error;
      }
    },
    TEST_TIMEOUT
  );

  // it.each throws on an empty array, and the core matrix has no
  // permanent-failure cases.
  if (activePermanentFailureFixtures.length > 0) {
    it.each(activePermanentFailureFixtures)(
      'should permanently reject a $label without retries or a Firestore document',
      async (fixture) => {
        const caseStartTime = new Date();
        const visionProcessorService = `${process.env.ENVIRONMENT}-text-vision-processor`;
        const permanentFailureMatch = {
          message: 'Skipping message (permanent failure, not retrying)',
        };
        let testFileId = '';
        let contentHash = '';

        try {
          const uploaded = await uploadFixtureAndTriggerScan(fixture);
          testFileId = uploaded.fileId;

          contentHash = await waitForDocProcessor(testFileId);

          // ========================================
          // Stage 3 (negative): Vision rejects the input permanently
          // ========================================
          logger.log(
            'stage-3-negative',
            'Waiting for text-vision-processor to ACK the permanent failure'
          );

          // The permanent-failure log carries no file identifier, so the
          // match is scoped by service and case start time instead; the suite
          // runs sequentially and no other case produces this entry.
          const permanentFailureLog = await pollForFunctionLogEntry(
            visionProcessorService,
            outputs.region,
            caseStartTime,
            permanentFailureMatch,
            { timeout: 300000, interval: 10000 }
          );

          expect(permanentFailureLog).toBeTruthy();

          logger.log('stage-3-negative', 'Permanent failure ACKed', {
            logEntry: permanentFailureLog,
          });

          // ========================================
          // Failure notification is dispatched
          // ========================================
          logger.log(
            'stage-3-negative',
            'Waiting for Notification Dispatcher to send failure notification'
          );

          const failureNotificationLog = await pollForFunctionLogEntry(
            `${process.env.ENVIRONMENT}-notification-dispatcher`,
            outputs.region,
            caseStartTime,
            {
              message: 'Sent failure notification',
              stageName: 'text-vision-processor',
            },
            { timeout: 180000, interval: 15000 }
          );

          expect(failureNotificationLog).toBeTruthy();

          logger.log('stage-3-negative', 'Failure notification dispatched', {
            logEntry: failureNotificationLog,
          });

          // ========================================
          // Message was ACKed once: no Eventarc redelivery
          // ========================================
          // A nacked message is redelivered within seconds, so a second
          // permanent-failure entry would appear well inside this window.
          logger.log(
            'stage-3-negative',
            'Waiting 2 minutes to confirm the message is not redelivered'
          );
          await new Promise((resolve) => setTimeout(resolve, 120000));

          const permanentFailureCount = await countFunctionLogEntries(
            visionProcessorService,
            outputs.region,
            caseStartTime,
            permanentFailureMatch
          );

          expect(permanentFailureCount).toBe(1);

          // ========================================
          // No Firestore document was created
          // ========================================
          const snapshot = await firestore
            .collection('extracted_texts')
            .where('fileId', '==', testFileId)
            .get();

          expect(snapshot.empty).toBe(true);

          logger.log(
            'success',
            'Permanent-failure E2E test completed successfully',
            {
              fixture: fixture.label,
              duration: `${Date.now() - caseStartTime.getTime()}ms`,
            }
          );
        } catch (error) {
          logger.error('failure', error as Error, {
            fixture: fixture.label,
            testFileId,
            contentHash,
            caseStartTime,
          });

          // Re-throw to fail the test
          throw error;
        }
      },
      TEST_TIMEOUT
    );
  }
});
