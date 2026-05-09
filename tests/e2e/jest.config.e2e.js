module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // E2E tests run sequentially to avoid resource conflicts
  maxWorkers: 1,
  maxConcurrency: 1,

  // Longer timeouts for E2E tests (25 minutes for full pipeline with cold starts)
  testTimeout: 1500000,

  // Setup and teardown
  globalSetup: '<rootDir>/setup/global-setup.ts',
  globalTeardown: '<rootDir>/setup/global-teardown.ts',

  // Coverage (optional for E2E)
  collectCoverage: false,

  // Verbose output for debugging
  verbose: true,

  // Transform TypeScript files
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },

  // Node options to support dynamic imports in google-auth-library
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
};
