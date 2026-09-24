import { Storage } from '@google-cloud/storage';
import { loadSourceDocument } from './source-document';

jest.mock('@google-cloud/storage');
const mockStorage = Storage as jest.MockedClass<typeof Storage>;

describe('loadSourceDocument', () => {
  let mockGetMetadata: jest.Mock;
  let mockDownload: jest.Mock;
  let mockFile: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetMetadata = jest.fn();
    mockDownload = jest.fn().mockResolvedValue([Buffer.from('%PDF-1.7')]);
    mockFile = jest.fn().mockReturnValue({
      getMetadata: mockGetMetadata,
      download: mockDownload,
    });
    mockStorage.mockImplementation(
      () =>
        ({
          bucket: jest.fn().mockReturnValue({ file: mockFile }),
        }) as never
    );
  });

  it('should return a PDF as base64 inline data', async () => {
    mockGetMetadata.mockResolvedValue([
      { contentType: 'application/pdf', size: '1024' },
    ]);

    const result = await loadSourceDocument('bucket', 'documents/abc123');

    expect(mockFile).toHaveBeenCalledWith('documents/abc123');
    expect(result).toEqual({
      mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.7').toString('base64'),
    });
  });

  it('should leave a format Gemini does not read to the OCR text', async () => {
    mockGetMetadata.mockResolvedValue([
      { contentType: 'image/tiff', size: '1024' },
    ]);

    const result = await loadSourceDocument('bucket', 'documents/abc123');

    expect(result).toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('should leave a file too large to send inline to the OCR text', async () => {
    mockGetMetadata.mockResolvedValue([
      { contentType: 'application/pdf', size: String(16 * 1024 * 1024) },
    ]);

    const result = await loadSourceDocument('bucket', 'documents/abc123');

    expect(result).toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('should fall back to the OCR text when the object is gone', async () => {
    mockGetMetadata.mockRejectedValue(
      Object.assign(new Error('No such object'), { code: 404 })
    );

    await expect(
      loadSourceDocument('bucket', 'documents/abc123')
    ).resolves.toBeNull();
  });

  it('should propagate any other storage error so the message is retried', async () => {
    mockGetMetadata.mockRejectedValue(
      Object.assign(new Error('Service unavailable'), { code: 503 })
    );

    await expect(
      loadSourceDocument('bucket', 'documents/abc123')
    ).rejects.toThrow('Service unavailable');
  });
});
