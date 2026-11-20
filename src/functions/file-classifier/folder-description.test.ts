import {
  MAX_FOLDER_DESCRIPTION_LENGTH,
  normalizeFolderDescription,
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
