import { logger } from './index';

describe('logger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const lastEntry = (spy: jest.SpyInstance): Record<string, unknown> =>
    JSON.parse((spy.mock.calls[0][0] as string).trim());

  it('writes INFO logs to stdout as one JSON line', () => {
    logger.info('hello');

    expect(stderrSpy).not.toHaveBeenCalled();
    const line = stdoutSpy.mock.calls[0][0] as string;
    expect(line.endsWith('\n')).toBe(true);
    expect(lastEntry(stdoutSpy)).toEqual({
      severity: 'INFO',
      message: 'hello',
    });
  });

  it('maps each method to its Cloud Logging severity', () => {
    logger.debug('d');
    expect(lastEntry(stdoutSpy).severity).toBe('DEBUG');
    stdoutSpy.mockClear();

    logger.warn('w');
    expect(lastEntry(stdoutSpy).severity).toBe('WARNING');
  });

  it('writes ERROR logs to stderr', () => {
    logger.error('boom');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(lastEntry(stderrSpy)).toEqual({
      severity: 'ERROR',
      message: 'boom',
    });
  });

  it('merges context fields into the entry', () => {
    logger.info('scanned', { folderId: 'abc', count: 3 });

    expect(lastEntry(stdoutSpy)).toEqual({
      severity: 'INFO',
      message: 'scanned',
      folderId: 'abc',
      count: 3,
    });
  });

  it('normalizes Error values so they are not dropped to {}', () => {
    const err = new Error('nope');
    logger.error('failed', { error: err });

    const entry = lastEntry(stderrSpy);
    expect(entry.error).toMatchObject({ name: 'Error', message: 'nope' });
    expect(typeof (entry.error as Record<string, unknown>).stack).toBe(
      'string'
    );
  });
});
