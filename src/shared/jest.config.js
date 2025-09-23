/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  collectCoverageFrom: [
    '*.{ts,tsx}',
    '!*.test.{ts,tsx}',
    '!*.spec.{ts,tsx}',
    '!dist/**',
    '!node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text'],
};
