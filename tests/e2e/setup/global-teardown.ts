export default async function globalTeardown(): Promise<void> {
  console.log('\n=== E2E Test Suite - Global Teardown ===\n');
  console.log(`Test End: ${new Date().toISOString()}\n`);
}
