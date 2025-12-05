/**
 * Manual mock for googleapis package to reduce memory usage during tests
 *
 * The actual googleapis package is 191MB and loads all Google API clients,
 * causing excessive memory consumption (2GB+) during Jest tests.
 * This mock provides only the Drive API interfaces needed for testing.
 */

export const google = {
  auth: {
    GoogleAuth: jest.fn().mockImplementation(() => ({})),
  },
  drive: jest.fn().mockReturnValue({
    files: {
      list: jest.fn(),
      get: jest.fn(),
    },
  }),
};
