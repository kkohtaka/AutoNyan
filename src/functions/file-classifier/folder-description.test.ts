import {
  MAX_FOLDER_DESCRIPTION_LENGTH,
  normalizeFolderDescription,
  resolveNamingRule,
} from './folder-description';

describe('normalizeFolderDescription', () => {
  it('should return undefined for a missing or blank description', () => {
    expect(normalizeFolderDescription(undefined)).toBeUndefined();
    expect(normalizeFolderDescription(null)).toBeUndefined();
    expect(normalizeFolderDescription('')).toBeUndefined();
    expect(normalizeFolderDescription(' \n ')).toBeUndefined();
  });

  it('should trim surrounding whitespace', () => {
    expect(normalizeFolderDescription('  YYYY-MM_発行元 \n')).toBe(
      'YYYY-MM_発行元'
    );
  });

  it('should cap the length', () => {
    const result = normalizeFolderDescription(
      'a'.repeat(MAX_FOLDER_DESCRIPTION_LENGTH + 1)
    );
    expect(result).toHaveLength(MAX_FOLDER_DESCRIPTION_LENGTH);
  });
});

describe('resolveNamingRule', () => {
  const folder = (
    id: string,
    parentId: string,
    path: string[],
    description?: string
  ) => ({
    id,
    name: path[path.length - 1],
    path,
    parentId,
    ...(description !== undefined ? { description } : {}),
  });

  const tree = [
    folder('a', 'root', ['請求書'], 'YYYY-MM_発行元'),
    folder('a1', 'a', ['請求書', '取引先A'], '   '),
    folder('a1x', 'a1', ['請求書', '取引先A', '2026']),
    folder('a2', 'a', ['請求書', '取引先B'], 'YYYYMMDD_番号'),
    folder('b', 'root', ['契約書']),
    folder('b1', 'b', ['契約書', '賃貸']),
  ];

  it("should use the destination folder's own rule when it has one", () => {
    expect(resolveNamingRule(tree, 'a2')).toBe('YYYYMMDD_番号');
  });

  it('should walk up past blank descriptions to the nearest rule', () => {
    expect(resolveNamingRule(tree, 'a1x')).toBe('YYYY-MM_発行元');
  });

  it('should return undefined when no folder up to the top level has a rule', () => {
    expect(resolveNamingRule(tree, 'b1')).toBeUndefined();
  });

  it('should return undefined for a folder outside the tree', () => {
    expect(resolveNamingRule(tree, 'unknown')).toBeUndefined();
  });
});
