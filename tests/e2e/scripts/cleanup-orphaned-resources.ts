#!/usr/bin/env tsx

/**
 * Cleanup orphaned E2E test resources
 *
 * This script removes test resources that were not cleaned up properly
 * (e.g., due to test failures or interruptions).
 */

import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';

const CLEANUP_THRESHOLD_HOURS = 24; // Clean up resources older than 24 hours

async function cleanupOrphanedResources(): Promise<void> {
  console.log('Starting cleanup of orphaned E2E test resources...');

  const environment = process.env.ENVIRONMENT || 'staging';
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;

  if (!projectId) {
    console.error('ERROR: PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set');
    process.exit(1);
  }

  const storage = new Storage();
  const firestore = new Firestore();

  const thresholdDate = new Date(
    Date.now() - CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000
  );

  console.log(`Environment: ${environment}`);
  console.log(`Project ID: ${projectId}`);
  console.log(
    `Cleaning up resources older than: ${thresholdDate.toISOString()}`
  );

  // Clean up Storage objects
  const buckets = [
    `${projectId}-${environment}-document-storage`,
    `${projectId}-${environment}-vision-results`,
  ];

  let totalFilesDeleted = 0;

  for (const bucketName of buckets) {
    try {
      console.log(`\nChecking bucket: ${bucketName}`);
      const bucket = storage.bucket(bucketName);
      const [files] = await bucket.getFiles();

      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const createdTime = new Date(metadata.timeCreated!);

        // Check if file is from E2E test and older than threshold
        const isE2ETest =
          metadata.metadata?.testRun === 'e2e' ||
          file.name.includes('e2e-test');

        if (isE2ETest && createdTime < thresholdDate) {
          console.log(
            `  Deleting: ${file.name} (created: ${createdTime.toISOString()})`
          );
          await file.delete().catch((err) => {
            const errMessage = err instanceof Error ? err.message : String(err);
            console.warn(`  Failed to delete ${file.name}:`, errMessage);
          });
          totalFilesDeleted++;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(`Failed to cleanup bucket ${bucketName}:`, errorMessage);
    }
  }

  // Clean up Firestore documents
  console.log(`\nChecking Firestore collection: extracted_texts`);
  let totalDocsDeleted = 0;

  try {
    const snapshot = await firestore
      .collection('extracted_texts')
      .where('extractedAt', '<', thresholdDate.toISOString())
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.fileName && data.fileName.includes('e2e-test')) {
        console.log(`  Deleting doc: ${doc.id} (file: ${data.fileName})`);
        await doc.ref.delete().catch((err) => {
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn(`  Failed to delete ${doc.id}:`, errMessage);
        });
        totalDocsDeleted++;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('Failed to cleanup Firestore:', errorMessage);
  }

  console.log('\n=== Cleanup Summary ===');
  console.log(`Storage files deleted: ${totalFilesDeleted}`);
  console.log(`Firestore docs deleted: ${totalDocsDeleted}`);
  console.log('Cleanup complete!');
}

// Run cleanup
cleanupOrphanedResources().catch((error) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
