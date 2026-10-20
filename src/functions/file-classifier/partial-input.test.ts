import { MAX_TEXT_LENGTH, preparePromptInput } from './partial-input';

describe('preparePromptInput', () => {
  it('should return the text unchanged with no note for complete input', () => {
    const result = preparePromptInput('短い文書', {
      totalPages: 3,
      includedPages: 3,
    });

    expect(result).toEqual({ text: '短い文書', partialInputNote: '' });
  });

  it('should return no note when page coverage is unknown and the text fits', () => {
    const result = preparePromptInput('短い文書');

    expect(result.partialInputNote).toBe('');
  });

  it('should describe omitted pages with the actual page numbers', () => {
    const result = preparePromptInput('先頭ページのテキスト', {
      totalPages: 200,
      includedPages: 20,
    });

    expect(result.text).toBe('先頭ページのテキスト');
    expect(result.partialInputNote).toContain('この文書は全200ページです');
    expect(result.partialInputNote).toContain(
      '以下は先頭20ページのテキストのみで'
    );
    expect(result.partialInputNote).not.toContain('文字のみ');
    expect(result.partialInputNote).toContain('抜粋として扱い');
  });

  it('should describe the character cut when the text exceeds the cap', () => {
    const text = 'あ'.repeat(MAX_TEXT_LENGTH + 1);

    const result = preparePromptInput(text);

    expect(result.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(result.partialInputNote).toContain(
      `冒頭${MAX_TEXT_LENGTH}文字のみで`
    );
    expect(result.partialInputNote).not.toContain('ページです');
  });

  it('should describe both cuts when pages are omitted and the text is cut', () => {
    const text = 'あ'.repeat(MAX_TEXT_LENGTH + 1);

    const result = preparePromptInput(text, {
      totalPages: 45,
      includedPages: 20,
    });

    expect(result.partialInputNote).toContain('この文書は全45ページです');
    expect(result.partialInputNote).toContain(
      `先頭20ページのテキストのうち冒頭${MAX_TEXT_LENGTH}文字のみで`
    );
  });

  it('should not cut text that is exactly at the cap', () => {
    const text = 'あ'.repeat(MAX_TEXT_LENGTH);

    const result = preparePromptInput(text);

    expect(result.text).toBe(text);
    expect(result.partialInputNote).toBe('');
  });
});
