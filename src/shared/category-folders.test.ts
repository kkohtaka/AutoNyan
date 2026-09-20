import { categoryFolderSetHash } from './category-folders';

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
