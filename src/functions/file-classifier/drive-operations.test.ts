import { DriveAuth } from 'autonyan-shared';
import { google } from 'googleapis';
import { listFileNamesInFolder, moveFileInDrive } from './drive-operations';

jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(),
  },
}));

const mockGoogle = google as jest.Mocked<typeof google>;

describe('listFileNamesInFolder', () => {
  const mockList = jest.fn();
  const auth = {} as DriveAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGoogle.drive.mockReturnValue({
      files: { list: mockList },
    } as never);
  });

  const respondWith = (files: { id: string; name: string }[]): void => {
    mockList.mockResolvedValue({ data: { files } });
  };

  it('should omit the file being classified from the returned names', async () => {
    respondWith([
      { id: 'other-file', name: '請求書_2024-02.pdf' },
      { id: 'processed-file', name: '請求書_2024-01.pdf' },
    ]);

    await expect(
      listFileNamesInFolder(auth, 'folder-id', 'processed-file')
    ).resolves.toEqual(['請求書_2024-02.pdf']);
  });

  it('should return every name when no file is excluded', async () => {
    respondWith([
      { id: 'a', name: '請求書_2024-02.pdf' },
      { id: 'b', name: '請求書_2024-01.pdf' },
    ]);

    await expect(listFileNamesInFolder(auth, 'folder-id')).resolves.toEqual([
      '請求書_2024-02.pdf',
      '請求書_2024-01.pdf',
    ]);
  });

  it('should cap the result at the reference limit after excluding', async () => {
    // The lister requests one row beyond the cap so that dropping the
    // excluded file still leaves a full set of reference names.
    respondWith([
      { id: 'processed-file', name: 'own.pdf' },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `file-${i}`,
        name: `file-${i}.pdf`,
      })),
    ]);

    const names = await listFileNamesInFolder(
      auth,
      'folder-id',
      'processed-file'
    );

    expect(names).toHaveLength(20);
    expect(names).not.toContain('own.pdf');
  });

  it('should request the id field and one row beyond the cap', async () => {
    respondWith([]);

    await listFileNamesInFolder(auth, 'folder-id', 'processed-file');

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'files(id, name)', pageSize: 21 })
    );
  });

  it('should return an empty list when the folder has no files', async () => {
    mockList.mockResolvedValue({ data: {} });

    await expect(
      listFileNamesInFolder(auth, 'folder-id', 'processed-file')
    ).resolves.toEqual([]);
  });
});

describe('moveFileInDrive', () => {
  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const auth = {} as DriveAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGoogle.drive.mockReturnValue({
      files: { get: mockGet, update: mockUpdate },
    } as never);
    mockUpdate.mockResolvedValue({ data: {} });
  });

  it('should re-parent and rename in a single update', async () => {
    mockGet.mockResolvedValue({ data: { parents: ['watched-folder'] } });

    await moveFileInDrive(auth, 'file-123', 'target-folder', 'new.pdf');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      fileId: 'file-123',
      addParents: 'target-folder',
      removeParents: 'watched-folder',
      requestBody: { name: 'new.pdf' },
      fields: 'id, parents',
      supportsAllDrives: true,
    });
  });

  it('should keep the name when none is given', async () => {
    mockGet.mockResolvedValue({ data: { parents: ['watched-folder'] } });

    await moveFileInDrive(auth, 'file-123', 'target-folder');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        addParents: 'target-folder',
        requestBody: {},
      })
    );
  });

  it('should only rename a file that already sits in the destination', async () => {
    mockGet.mockResolvedValue({ data: { parents: ['target-folder'] } });

    await moveFileInDrive(auth, 'file-123', 'target-folder', 'new.pdf');

    expect(mockUpdate).toHaveBeenCalledWith({
      fileId: 'file-123',
      requestBody: { name: 'new.pdf' },
      fields: 'id, parents',
      supportsAllDrives: true,
    });
  });

  it('should make no update when the file is in place and keeps its name', async () => {
    mockGet.mockResolvedValue({ data: { parents: ['target-folder'] } });

    await moveFileInDrive(auth, 'file-123', 'target-folder');

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should add the destination to a file Drive reports no parents for', async () => {
    mockGet.mockResolvedValue({ data: {} });

    await moveFileInDrive(auth, 'file-123', 'target-folder');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        addParents: 'target-folder',
        removeParents: undefined,
      })
    );
  });
});
