import { classifyWithGemini } from './classification';
import { MAX_TEXT_LENGTH } from './partial-input';

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

const categories = [
  { id: 'folder-invoices', name: '請求書' },
  { id: 'folder-contracts', name: '契約書' },
];

describe('classifyWithGemini', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          category: '請求書',
          confidence: 0.9,
          reasoning: '金額と支払期限の記載',
          summary: '請求書',
        })
      )
    );
  });

  it('should map the chosen category to its folder', async () => {
    const result = await classifyWithGemini(
      'test-project',
      '請求書 金額: 10000円',
      categories
    );

    expect(result).toEqual({
      categoryName: '請求書',
      categoryFolderId: 'folder-invoices',
      confidence: 0.9,
      reasoning: '金額と支払期限の記載',
      summary: '請求書',
    });
  });

  it('should send the prompt without a partial-input note for complete input', async () => {
    await classifyWithGemini(
      'test-project',
      '請求書 金額: 10000円',
      categories,
      {
        totalPages: 2,
        includedPages: 2,
      }
    );

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('【文書テキスト】\n請求書 金額: 10000円');
    expect(prompt).not.toContain('テキストは一部のみ');
  });

  it('should tell the model when only the opening pages are included', async () => {
    await classifyWithGemini('test-project', '表紙のテキスト', categories, {
      totalPages: 200,
      includedPages: 20,
    });

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('【注意：テキストは一部のみ】');
    expect(prompt).toContain('この文書は全200ページです');
    expect(prompt).toContain('先頭20ページのテキストのみで');
    expect(prompt.indexOf('テキストは一部のみ')).toBeLessThan(
      prompt.indexOf('【文書テキスト】')
    );
  });

  it('should tell the model when the text was cut by characters', async () => {
    await classifyWithGemini(
      'test-project',
      'あ'.repeat(MAX_TEXT_LENGTH + 100),
      categories
    );

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain(`冒頭${MAX_TEXT_LENGTH}文字のみで`);
    expect(prompt).not.toContain('あ'.repeat(MAX_TEXT_LENGTH + 1));
  });

  it('should return uncategorized when the model picks no category', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          category: 'UNCATEGORIZED',
          confidence: 0.4,
          reasoning: '該当なし',
          summary: 'メモ',
        })
      )
    );

    const result = await classifyWithGemini('test-project', 'メモ', categories);

    expect(result.categoryName).toBeNull();
    expect(result.categoryFolderId).toBeNull();
    expect(result.confidence).toBe(0.4);
  });

  it('should return uncategorized when the model names an unknown category', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          category: '領収書',
          confidence: 0.8,
          reasoning: '領収書に見える',
          summary: '領収書',
        })
      )
    );

    const result = await classifyWithGemini(
      'test-project',
      '領収書',
      categories
    );

    expect(result.categoryName).toBeNull();
    expect(result.categoryFolderId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('not found in available folders');
  });

  it('should parse JSON wrapped in a markdown code block', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        '```json\n{"category":"契約書","confidence":1.5,"reasoning":"r","summary":"s"}\n```'
      )
    );

    const result = await classifyWithGemini('test-project', '契約', categories);

    expect(result.categoryFolderId).toBe('folder-contracts');
    expect(result.confidence).toBe(1);
  });

  it('should throw when the model returns nothing', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse(undefined));

    await expect(
      classifyWithGemini('test-project', 'text', categories)
    ).rejects.toThrow('No response from Gemini API');
  });

  it('should throw when the response has no JSON object', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse('no json here'));

    await expect(
      classifyWithGemini('test-project', 'text', categories)
    ).rejects.toThrow('No JSON object found in Gemini response');
  });

  it('should throw when the JSON lacks required fields', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(JSON.stringify({ category: '請求書' }))
    );

    await expect(
      classifyWithGemini('test-project', 'text', categories)
    ).rejects.toThrow('Invalid response structure from Gemini');
  });
});
