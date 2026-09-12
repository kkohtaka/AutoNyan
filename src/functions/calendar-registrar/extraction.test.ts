import { resolveEventDate } from './extraction';

describe('resolveEventDate', () => {
  it('should keep a date that already carries a year', () => {
    expect(
      resolveEventDate('2026-01-15', new Date('2026-03-01T00:00:00Z'))
    ).toBe('2026-01-15');
  });

  it('should resolve a year-less date to the reference year', () => {
    expect(resolveEventDate('03-15', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2026-03-15'
    );
  });

  it('should roll a year-less date into the next year when the month precedes the reference month', () => {
    expect(resolveEventDate('01-10', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2027-01-10'
    );
  });

  it('should keep a later month in the reference year', () => {
    expect(resolveEventDate('12-24', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2026-12-24'
    );
  });

  it('should reject an unsupported date format', () => {
    expect(() =>
      resolveEventDate('15日', new Date('2026-03-01T00:00:00Z'))
    ).toThrow(/Unsupported date format/);
  });
});
