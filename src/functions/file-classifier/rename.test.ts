import {
  generateFileName,
  resolveRenamedFileName,
  sanitizeFileName,
  RENAME_CONFIDENCE_THRESHOLD,
  FileNameGenerationResult,
} from './rename';

const mockGenerateContent = jest.fn();

jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

const geminiResponse = (text: string | undefined) => ({
  response: {
    candidates: text === undefined ? [] : [{ content: { parts: [{ text }] } }],
  },
});

describe('generateFileName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return parsed file name proposal', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          fileName: '2024-01-31_請求書_サンプル商事',
          confidence: 0.9,
          reasoning: '既存の日付プレフィックス形式に合わせました',
        })
      )
    );

    const result = await generateFileName(
      'test-project',
      '請求書 金額: 10000円',
      'scan_0001.pdf',
      ['2024-01-15_請求書_ネコ商会.pdf']
    );

    expect(result).toEqual({
      fileName: '2024-01-31_請求書_サンプル商事',
      confidence: 0.9,
      reasoning: '既存の日付プレフィックス形式に合わせました',
    });

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('scan_0001.pdf');
    expect(prompt).toContain('2024-01-15_請求書_ネコ商会.pdf');
    expect(prompt).toContain('命名規則');
  });

  it('should prompt for content-only naming when the folder is empty', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          fileName: '請求書_サンプル商事',
          confidence: 0.8,
          reasoning: '内容から命名しました',
        })
      )
    );

    await generateFileName('test-project', '請求書', 'scan_0001.pdf', []);

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('まだファイルがない');
    expect(prompt).not.toContain('既存ファイル名（新しい順）');
  });

  it('should parse JSON wrapped in a markdown code block', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        '```json\n{"fileName": "請求書", "confidence": 0.9, "reasoning": "内容から"}\n```'
      )
    );

    const result = await generateFileName('test-project', 'text', 'a.pdf', []);

    expect(result.fileName).toBe('請求書');
  });

  it('should clamp confidence into the 0..1 range', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({ fileName: '請求書', confidence: 1.5, reasoning: 'r' })
      )
    );

    const result = await generateFileName('test-project', 'text', 'a.pdf', []);

    expect(result.confidence).toBe(1);
  });

  it('should throw when Gemini returns no response', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse(undefined));

    await expect(
      generateFileName('test-project', 'text', 'a.pdf', [])
    ).rejects.toThrow('No response from Gemini API');
  });

  it('should throw when the response contains no JSON object', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse('回答できません'));

    await expect(
      generateFileName('test-project', 'text', 'a.pdf', [])
    ).rejects.toThrow('No JSON object found in Gemini response');
  });

  it('should throw when the response structure is invalid', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(JSON.stringify({ fileName: 123, confidence: 'high' }))
    );

    await expect(
      generateFileName('test-project', 'text', 'a.pdf', [])
    ).rejects.toThrow('Invalid response structure from Gemini');
  });
});

describe('sanitizeFileName', () => {
  it('should replace path separators and collapse whitespace', () => {
    expect(sanitizeFileName('請求書/2024\\01月分')).toBe('請求書 2024 01月分');
  });

  it('should replace newlines and control characters with spaces', () => {
    expect(sanitizeFileName('\u8acb\u6c42\u66f8\n2024\t01\u6708\u5206')).toBe(
      '\u8acb\u6c42\u66f8 2024 01\u6708\u5206'
    );
  });

  it('should cap the length', () => {
    expect(sanitizeFileName('a'.repeat(200)).length).toBe(100);
  });

  it('should return an empty string when nothing survives', () => {
    expect(sanitizeFileName(' / \n ')).toBe('');
  });
});

describe('resolveRenamedFileName', () => {
  const generated = (
    fileName: string,
    confidence = 0.9
  ): FileNameGenerationResult => ({
    fileName,
    confidence,
    reasoning: 'test',
  });

  it('should append the original extension to the generated base name', () => {
    expect(
      resolveRenamedFileName(generated('請求書_2024-01'), 'scan.pdf', [])
    ).toBe('請求書_2024-01.pdf');
  });

  it('should keep the original name when confidence is below the threshold', () => {
    expect(
      resolveRenamedFileName(
        generated('請求書', RENAME_CONFIDENCE_THRESHOLD - 0.01),
        'scan.pdf',
        []
      )
    ).toBeNull();
  });

  it('should keep the original name when the generated name equals it', () => {
    expect(
      resolveRenamedFileName(generated('scan'), 'scan.pdf', [])
    ).toBeNull();
  });

  it('should keep the original name when sanitization leaves nothing', () => {
    expect(
      resolveRenamedFileName(generated(' / \n '), 'scan.pdf', [])
    ).toBeNull();
  });

  it('should strip an extension the model included anyway', () => {
    expect(
      resolveRenamedFileName(generated('請求書_2024-01.PDF'), 'scan.pdf', [])
    ).toBe('請求書_2024-01.pdf');
  });

  it('should handle an original name without an extension', () => {
    expect(resolveRenamedFileName(generated('請求書'), 'scan', [])).toBe(
      '請求書'
    );
  });

  it('should suffix -2, -3, ... on collisions with existing names', () => {
    expect(
      resolveRenamedFileName(generated('請求書'), 'scan.pdf', [
        '請求書.pdf',
        '請求書-2.pdf',
      ])
    ).toBe('請求書-3.pdf');
  });
});
