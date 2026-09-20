import { google } from 'googleapis';
import { listFileNamesInFolder } from './drive-operations';

jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(),
  },
}));

const mockGoogle = google as jest.Mocked<typeof google>;

describe('listFileNamesInFolder', () => {
  const mockList = jest.fn();
  const auth = {} as InstanceType<typeof google.auth.GoogleAuth>;

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
