#!/usr/bin/env tsx

/**
 * Test Firestore trigger by manually creating a document
 * and monitoring for File Classifier execution
 */

import { Firestore } from '@google-cloud/firestore';
import * as path from 'path';
import * as fs from 'fs';

interface TerraformVariables {
  [key: string]: string;
}

function getTerraformVariables(): TerraformVariables {
  const environment = process.env.ENVIRONMENT || 'staging';
  const terraformDir = path.join(process.cwd(), 'terraform');
  const tfvarsPath = path.join(
    terraformDir,
    'environments',
    `${environment}.tfvars`
  );

  if (!fs.existsSync(tfvarsPath)) {
    throw new Error(`terraform.tfvars not found at ${tfvarsPath}`);
  }

  const content = fs.readFileSync(tfvarsPath, 'utf-8');
  const variables: TerraformVariables = {};

  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*=\s*"([^"]+)"/);
    if (match) {
      const [, key, value] = match;
      variables[key] = value;
    }
  }

  return variables;
}

async function testFirestoreTrigger(): Promise<void> {
  console.log('Testing Firestore trigger for File Classifier...\n');

  try {
    const tfvars = getTerraformVariables();
    const projectId = tfvars.project_id;

    console.log(`Project: ${projectId}\n`);

    // Initialize Firestore
    const firestore = new Firestore({
      projectId: projectId,
    });

    // Create a test document
    const testFileId = `test-trigger-${Date.now()}`;
    console.log(`Creating test document with fileId: ${testFileId}...`);

    const testDoc = {
      fileId: testFileId,
      fileName: 'test-firestore-trigger.txt',
      extractedText: 'This is a test document to verify Firestore trigger.',
      confidence: 1.0,
      pages: [
        {
          text: 'Test content',
          pageNumber: 1,
          confidence: 1.0,
        },
      ],
      extractedAt: new Date().toISOString(),
      mimeType: 'text/plain',
      fileSize: 100,
      contentHash: 'test-hash-123',
      objectName: 'test-object',
      visionResultPath: 'gs://test/path',
    };

    const docRef = await firestore.collection('extracted_texts').add(testDoc);
    console.log(`✅ Document created with ID: ${docRef.id}\n`);

    console.log(
      'Waiting 60 seconds for File Classifier to process the document...\n'
    );
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Check if document was updated with classification
    const updatedDoc = await docRef.get();
    const data = updatedDoc.data();

    if (data && data.category !== undefined) {
      console.log('✅ File Classifier processed the document successfully!\n');
      console.log('Classification results:');
      console.log(`  Category: ${data.category}`);
      console.log(`  Confidence: ${data.classificationConfidence}`);
      console.log(`  Reasoning: ${data.classificationReasoning}\n`);

      // Clean up
      await docRef.delete();
      console.log('Test document cleaned up.\n');

      console.log('✅ Firestore trigger test PASSED');
      console.log('   File Classifier is working correctly!\n');
    } else {
      console.log('❌ File Classifier did NOT process the document\n');
      console.log('Current document data:');
      console.log(JSON.stringify(data, null, 2));
      console.log('\nPossible issues:');
      console.log('  1. Eventarc trigger not firing');
      console.log('  2. File Classifier function errors');
      console.log('  3. IAM permissions missing\n');

      console.log('Check File Classifier logs:');
      console.log(
        '  gcloud logging read \'resource.labels.service_name="staging-file-classifier"\' --limit=20 --freshness=5m\n'
      );

      // Clean up
      await docRef.delete();

      process.exit(1);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Test failed\n');
    console.error('Error:', errorMessage);
    process.exit(1);
  }
}

testFirestoreTrigger();
