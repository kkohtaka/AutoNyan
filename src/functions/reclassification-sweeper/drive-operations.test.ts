import { google } from 'googleapis';
import { getFileParents } from './drive-operations';

const mockFilesGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({ files: { get: mockFilesGet } })),
  },
}));

const auth = {} as InstanceType<typeof google.auth.GoogleAuth>;

describe('getFileParents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return the parent folder IDs', async () => {
    mockFilesGet.mockResolvedValue({ data: { parents: ['folder-a'] } });

    await expect(getFileParents(auth, 'file-123')).resolves.toEqual([
      'folder-a',
    ]);
  });

  it('should report a deleted file as gone instead of throwing', async () => {
    mockFilesGet.mockRejectedValue(
      Object.assign(new Error('File not found: file-123.'), { code: 404 })
    );

    await expect(getFileParents(auth, 'file-123')).resolves.toBeNull();
  });

  it('should rethrow a transient Drive failure', async () => {
    mockFilesGet.mockRejectedValue(
      Object.assign(new Error('Backend Error'), { code: 500 })
    );

    await expect(getFileParents(auth, 'file-123')).rejects.toThrow(
      'Backend Error'
    );
  });
});
