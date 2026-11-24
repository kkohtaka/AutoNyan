import { CategoryFolder } from './category-folders';
import {
  folderOrganizationFingerprint,
  listCategorySubtree,
  namingRuleHash,
} from './folder-organization';

const folder = (
  id: string,
  parentId: string,
  path: string[],
  description?: string
): CategoryFolder => ({
  id,
  name: path[path.length - 1],
  path,
  parentId,
  ...(description !== undefined ? { description } : {}),
});

const tree = [
  folder('a', 'root', ['請求書'], 'YYYY-MM_発行元'),
  folder('a1', 'a', ['請求書', '取引先A']),
  folder('a1x', 'a1', ['請求書', '取引先A', '2026']),
  folder('a2', 'a', ['請求書', '取引先B'], 'YYYYMMDD_番号'),
  folder('b', 'root', ['契約書']),
];

describe('namingRuleHash', () => {
  it('should be stable for the same rule', () => {
    expect(namingRuleHash('YYYY-MM_発行元')).toBe(
      namingRuleHash('YYYY-MM_発行元')
    );
  });

  it('should differ between rules and from a folder without one', () => {
    expect(namingRuleHash('YYYY-MM_発行元')).not.toBe(
      namingRuleHash('YYYYMMDD_番号')
    );
    expect(namingRuleHash('YYYY-MM_発行元')).not.toBe(
      namingRuleHash(undefined)
    );
  });
});

describe('folderOrganizationFingerprint', () => {
  it('should not depend on the order the folders are listed in', () => {
    expect(folderOrganizationFingerprint([...tree].reverse(), 'a')).toBe(
      folderOrganizationFingerprint(tree, 'a')
    );
  });

  it("should change when the folder's own description changes", () => {
    const edited = tree.map((f) =>
      f.id === 'a' ? { ...f, description: 'YYYY_発行元' } : f
    );

    expect(folderOrganizationFingerprint(edited, 'a')).not.toBe(
      folderOrganizationFingerprint(tree, 'a')
    );
  });

  it('should change for a subfolder that inherits the edited rule', () => {
    const edited = tree.map((f) =>
      f.id === 'a' ? { ...f, description: 'YYYY_発行元' } : f
    );

    expect(folderOrganizationFingerprint(edited, 'a1')).not.toBe(
      folderOrganizationFingerprint(tree, 'a1')
    );
  });

  it('should not change for a subfolder with a rule of its own', () => {
    const edited = tree.map((f) =>
      f.id === 'a' ? { ...f, description: 'YYYY_発行元' } : f
    );

    expect(folderOrganizationFingerprint(edited, 'a2')).toBe(
      folderOrganizationFingerprint(tree, 'a2')
    );
  });

  it('should change when a direct subfolder is added', () => {
    const grown = [...tree, folder('a3', 'a', ['請求書', '取引先C'])];

    expect(folderOrganizationFingerprint(grown, 'a')).not.toBe(
      folderOrganizationFingerprint(tree, 'a')
    );
  });

  it('should not change when a folder is added deeper down or elsewhere', () => {
    const grown = [
      ...tree,
      folder('a1y', 'a1', ['請求書', '取引先A', '2027']),
      folder('b1', 'b', ['契約書', '賃貸']),
    ];

    expect(folderOrganizationFingerprint(grown, 'a')).toBe(
      folderOrganizationFingerprint(tree, 'a')
    );
  });

  it('should ignore a description that only differs in surrounding whitespace', () => {
    const padded = tree.map((f) =>
      f.id === 'a' ? { ...f, description: '  YYYY-MM_発行元\n' } : f
    );

    expect(folderOrganizationFingerprint(padded, 'a')).toBe(
      folderOrganizationFingerprint(tree, 'a')
    );
  });
});

describe('listCategorySubtree', () => {
  it('should return the folder followed by everything below it', () => {
    expect(listCategorySubtree(tree, 'a').map((f) => f.id)).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
    ]);
  });

  it('should return only the folder when it has no subfolders', () => {
    expect(listCategorySubtree(tree, 'b').map((f) => f.id)).toEqual(['b']);
  });

  it('should return nothing for a folder outside the tree', () => {
    expect(listCategorySubtree(tree, 'missing')).toEqual([]);
  });
});
