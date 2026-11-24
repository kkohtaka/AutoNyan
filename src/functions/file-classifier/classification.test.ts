import { classifyWithGemini } from './classification';
import { MAX_FOLDER_DESCRIPTION_LENGTH } from 'autonyan-shared';
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

const topLevel = (id: string, name: string, description?: string) => ({
  id,
  name,
  path: [name],
  parentId: 'root',
  ...(description ? { description } : {}),
});

const subfolder = (
  id: string,
  parent: { id: string; path: string[] },
  name: string
) => ({ id, name, path: [...parent.path, name], parentId: parent.id });

const invoices = topLevel('folder-invoices', '請求書');
const contracts = topLevel('folder-contracts', '契約書');
const categories = [invoices, contracts];

const vendor = subfolder('folder-vendor', invoices, '取引先A');
const vendorYear = subfolder('folder-vendor-2026', vendor, '2026');
const nestedCategories = [invoices, vendor, vendorYear, contracts];

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
      categoryPath: ['請求書'],
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

  it('should list each category description next to its name, and a name alone without one', async () => {
    await classifyWithGemini('test-project', '請求書', [
      topLevel('folder-invoices', '請求書', '取引先からの請求書'),
      contracts,
    ]);

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain(
      '1. 請求書\n   説明: 取引先からの請求書\n2. 契約書\n\n'
    );
  });

  it('should truncate a description longer than the cap', async () => {
    await classifyWithGemini('test-project', '請求書', [
      topLevel(
        'folder-invoices',
        '請求書',
        'あ'.repeat(MAX_FOLDER_DESCRIPTION_LENGTH + 50)
      ),
    ]);

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('あ'.repeat(MAX_FOLDER_DESCRIPTION_LENGTH));
    expect(prompt).not.toContain(
      'あ'.repeat(MAX_FOLDER_DESCRIPTION_LENGTH + 1)
    );
  });

  it('should still match the chosen category by name when descriptions are present', async () => {
    const result = await classifyWithGemini('test-project', '請求書', [
      topLevel('folder-invoices', '請求書', '取引先からの請求書'),
    ]);

    expect(result.categoryFolderId).toBe('folder-invoices');
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
    expect(result.categoryPath).toBeNull();
    expect(result.categoryFolderId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('not found in available folders');
  });

  describe('with subfolders', () => {
    const respondWith = (category: string) =>
      mockGenerateContent.mockResolvedValue(
        geminiResponse(
          JSON.stringify({
            category,
            confidence: 0.9,
            reasoning: 'r',
            summary: 's',
          })
        )
      );

    it('should list every folder as a path, each parent followed by its subfolders', async () => {
      await classifyWithGemini('test-project', '請求書', nestedCategories);

      const prompt = mockGenerateContent.mock.calls[0][0] as string;
      expect(prompt).toContain(
        '1. 請求書\n2. 請求書/取引先A\n3. 請求書/取引先A/2026\n4. 契約書\n\n'
      );
    });

    it('should tell the model how to answer with a subfolder path', async () => {
      await classifyWithGemini('test-project', '請求書', nestedCategories);

      const prompt = mockGenerateContent.mock.calls[0][0] as string;
      expect(prompt).toContain('「/」を含むパス全体を記入してください');
      expect(prompt).toContain('親のカテゴリー自体を選んでください');
    });

    it('should not mention subfolders when the category root is flat', async () => {
      await classifyWithGemini('test-project', '請求書', categories);

      const prompt = mockGenerateContent.mock.calls[0][0] as string;
      expect(prompt).not.toContain('サブフォルダ');
      expect(prompt).toContain(
        '（説明は含めないでください）\n- どのカテゴリーにも当てはまらない場合は'
      );
    });

    it('should file into the subfolder the response names by its exact path', async () => {
      respondWith('請求書/取引先A/2026');

      const result = await classifyWithGemini(
        'test-project',
        '請求書',
        nestedCategories
      );

      expect(result).toMatchObject({
        categoryName: '請求書',
        categoryPath: ['請求書', '取引先A', '2026'],
        categoryFolderId: 'folder-vendor-2026',
      });
    });

    it('should file into the category itself when the response names a category that has subfolders', async () => {
      respondWith('請求書');

      const result = await classifyWithGemini(
        'test-project',
        '請求書',
        nestedCategories
      );

      expect(result).toMatchObject({
        categoryName: '請求書',
        categoryPath: ['請求書'],
        categoryFolderId: 'folder-invoices',
      });
    });

    it('should treat a subfolder named without its parents as an unknown category', async () => {
      respondWith('取引先A');

      const result = await classifyWithGemini(
        'test-project',
        '請求書',
        nestedCategories
      );

      expect(result.categoryFolderId).toBeNull();
      expect(result.confidence).toBe(0);
    });
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
