import { DriveAuth } from 'autonyan-shared';
import { getFileState } from './drive-operations';

const mockFilesGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({ files: { get: mockFilesGet } })),
  },
}));

const auth = {} as DriveAuth;

describe('getFileState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return the parent folder IDs and the modified time', async () => {
    mockFilesGet.mockResolvedValue({
      data: { parents: ['folder-a'], modifiedTime: '2026-09-01T00:00:00.000Z' },
    });

    await expect(getFileState(auth, 'file-123')).resolves.toEqual({
      parents: ['folder-a'],
      modifiedTime: '2026-09-01T00:00:00.000Z',
    });
    expect(mockFilesGet).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'parents,modifiedTime' })
    );
  });

  it('should omit the modified time when Drive reports none', async () => {
    mockFilesGet.mockResolvedValue({ data: {} });

    await expect(getFileState(auth, 'file-123')).resolves.toEqual({
      parents: [],
    });
  });

  it('should report a deleted file as gone instead of throwing', async () => {
    mockFilesGet.mockRejectedValue(
      Object.assign(new Error('File not found: file-123.'), { code: 404 })
    );

    await expect(getFileState(auth, 'file-123')).resolves.toBeNull();
  });

  it('should rethrow a transient Drive failure', async () => {
    mockFilesGet.mockRejectedValue(
      Object.assign(new Error('Backend Error'), { code: 500 })
    );

    await expect(getFileState(auth, 'file-123')).rejects.toThrow(
      'Backend Error'
    );
  });
});
