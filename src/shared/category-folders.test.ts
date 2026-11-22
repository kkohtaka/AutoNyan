import type { drive_v3 } from 'googleapis';
import {
  categoryFolderSetHash,
  formatCategoryPath,
  listCategoryTree,
  MAX_CATEGORY_DEPTH,
} from './category-folders';

describe('formatCategoryPath', () => {
  it('should render a top-level category as its name', () => {
    expect(formatCategoryPath(['請求書'])).toBe('請求書');
  });

  it('should join a nested path from the top-level category down', () => {
    expect(formatCategoryPath(['請求書', '取引先A', '2026'])).toBe(
      '請求書/取引先A/2026'
    );
  });
});

describe('listCategoryTree', () => {
  const mockList = jest.fn();
  const drive = { files: { list: mockList } } as unknown as drive_v3.Drive;

  interface ListedFolder {
    id: string;
    name: string;
    parents?: string[];
    description?: string;
  }

  // Answers each listing from a parent → children table, the way Drive
  // answers an `in parents` query.
  const givenFolders = (childrenByParent: Record<string, ListedFolder[]>) => {
    mockList.mockImplementation(({ q }: { q: string }) => {
      const parentIds = [...q.matchAll(/'([^']+)' in parents/g)].map(
        (match) => match[1]
      );
      return Promise.resolve({
        data: {
          files: parentIds.flatMap((parentId) =>
            (childrenByParent[parentId] ?? []).map((folder) => ({
              parents: [parentId],
              ...folder,
            }))
          ),
        },
      });
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should list a root without subfolders as flat top-level categories', async () => {
    givenFolders({
      root: [
        { id: 'a', name: '請求書', description: 'YYYY-MM_発行元' },
        { id: 'b', name: '契約書', description: '' },
      ],
    });

    await expect(listCategoryTree(drive, 'root')).resolves.toEqual([
      {
        id: 'a',
        name: '請求書',
        path: ['請求書'],
        parentId: 'root',
        description: 'YYYY-MM_発行元',
      },
      { id: 'b', name: '契約書', path: ['契約書'], parentId: 'root' },
    ]);
  });

  it('should request folders only, across shared drives, with their description and parents', async () => {
    givenFolders({ root: [] });

    await listCategoryTree(drive, 'root');

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "('root' in parents) and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'nextPageToken, files(id, name, description, parents)',
        orderBy: 'name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
    );
  });

  it('should place each subfolder directly after its parent with its full path', async () => {
    givenFolders({
      root: [
        { id: 'a', name: '請求書' },
        { id: 'b', name: '契約書' },
      ],
      a: [
        { id: 'a1', name: '取引先A' },
        { id: 'a2', name: '取引先B' },
      ],
      a1: [{ id: 'a1x', name: '2026' }],
    });

    const tree = await listCategoryTree(drive, 'root');

    expect(tree.map((folder) => [folder.id, folder.path])).toEqual([
      ['a', ['請求書']],
      ['a1', ['請求書', '取引先A']],
      ['a1x', ['請求書', '取引先A', '2026']],
      ['a2', ['請求書', '取引先B']],
      ['b', ['契約書']],
    ]);
    expect(tree.find((folder) => folder.id === 'a1x')?.parentId).toBe('a1');
  });

  it('should list one level per call, naming every parent of that level', async () => {
    givenFolders({
      root: [
        { id: 'a', name: '請求書' },
        { id: 'b', name: '契約書' },
      ],
      a: [{ id: 'a1', name: '取引先A' }],
      b: [{ id: 'b1', name: '賃貸' }],
    });

    await listCategoryTree(drive, 'root');

    expect(mockList).toHaveBeenCalledTimes(MAX_CATEGORY_DEPTH);
    expect(mockList.mock.calls[1][0].q).toContain(
      "('a' in parents or 'b' in parents)"
    );
    expect(mockList.mock.calls[2][0].q).toContain(
      "('a1' in parents or 'b1' in parents)"
    );
  });

  it('should not list below the maximum depth', async () => {
    givenFolders({
      root: [{ id: 'd1', name: 'L1' }],
      d1: [{ id: 'd2', name: 'L2' }],
      d2: [{ id: 'd3', name: 'L3' }],
      d3: [{ id: 'd4', name: 'L4' }],
    });

    const tree = await listCategoryTree(drive, 'root');

    expect(tree.map((folder) => folder.id)).toEqual(['d1', 'd2', 'd3']);
    expect(mockList).toHaveBeenCalledTimes(MAX_CATEGORY_DEPTH);
  });

  it('should skip a folder whose name starts with an underscore together with its subtree', async () => {
    givenFolders({
      root: [
        { id: 'a', name: '請求書' },
        { id: 'x', name: '_archive' },
      ],
      a: [
        { id: 'a1', name: '取引先A' },
        { id: 'a9', name: '_old' },
      ],
      x: [{ id: 'x1', name: '2020' }],
      a9: [{ id: 'a9x', name: '2019' }],
    });

    const tree = await listCategoryTree(drive, 'root');

    expect(tree.map((folder) => folder.id)).toEqual(['a', 'a1']);
    expect(mockList.mock.calls[1][0].q).not.toContain("'x' in parents");
    expect(mockList.mock.calls[2][0].q).not.toContain("'a9' in parents");
  });

  it('should follow pagination within a level', async () => {
    mockList
      .mockResolvedValueOnce({
        data: {
          files: [{ id: 'a', name: '請求書', parents: ['root'] }],
          nextPageToken: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        data: { files: [{ id: 'b', name: '契約書', parents: ['root'] }] },
      })
      .mockResolvedValue({ data: {} });

    const tree = await listCategoryTree(drive, 'root');

    expect(tree.map((folder) => folder.id)).toEqual(['a', 'b']);
    expect(mockList.mock.calls[0][0].pageToken).toBeUndefined();
    expect(mockList.mock.calls[1][0].pageToken).toBe('page-2');
  });

  it('should split a level wider than one query can name', async () => {
    const topLevel = Array.from({ length: 30 }, (_, index) => ({
      id: `c${index}`,
      name: `カテゴリ${index}`,
    }));
    givenFolders({ root: topLevel, c29: [{ id: 'c29a', name: 'サブ' }] });

    const tree = await listCategoryTree(drive, 'root');

    // Level 1 in one query, level 2 in two, level 3 in one.
    expect(mockList).toHaveBeenCalledTimes(4);
    expect(tree.find((folder) => folder.id === 'c29a')?.path).toEqual([
      'カテゴリ29',
      'サブ',
    ]);
  });

  it('should keep a top-level folder whose listing omits its parents', async () => {
    mockList
      .mockResolvedValueOnce({
        data: { files: [{ id: 'a', name: '請求書' }] },
      })
      .mockResolvedValue({ data: { files: [] } });

    await expect(listCategoryTree(drive, 'root')).resolves.toEqual([
      { id: 'a', name: '請求書', path: ['請求書'], parentId: 'root' },
    ]);
  });

  it('should drop a subfolder that cannot be attributed to a queried parent', async () => {
    mockList
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'a', name: '請求書', parents: ['root'] },
            { id: 'b', name: '契約書', parents: ['root'] },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [{ id: 'stray', name: '迷子', parents: ['elsewhere'] }],
        },
      })
      .mockResolvedValue({ data: { files: [] } });

    const tree = await listCategoryTree(drive, 'root');

    expect(tree.map((folder) => folder.id)).toEqual(['a', 'b']);
  });
});

describe('categoryFolderSetHash', () => {
  it('should not depend on the order of the folder IDs', () => {
    expect(categoryFolderSetHash(['a', 'b', 'c'])).toBe(
      categoryFolderSetHash(['c', 'a', 'b'])
    );
  });

  it('should change when a folder is added', () => {
    expect(categoryFolderSetHash(['a', 'b'])).not.toBe(
      categoryFolderSetHash(['a', 'b', 'c'])
    );
  });

  it('should change when a folder is removed', () => {
    expect(categoryFolderSetHash(['a', 'b'])).not.toBe(
      categoryFolderSetHash(['a'])
    );
  });

  it('should handle an empty folder set', () => {
    expect(categoryFolderSetHash([])).toEqual(expect.any(String));
  });
});
