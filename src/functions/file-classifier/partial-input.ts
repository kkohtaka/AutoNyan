export interface PageInfo {
  totalPages: number;
  includedPages: number;
}

export interface PromptInput {
  text: string;
  partialInputNote: string;
}

// The classification and naming prompts only need a document's opening; the
// cap bounds the cost of each Gemini call.
export const MAX_TEXT_LENGTH = 3000;

/**
 * Cut the text for a prompt and describe what the model will not see.
 *
 * The upstream writer keeps only the first pages of a long document, and this
 * module cuts the text again by characters. Either cut turns the text into an
 * excerpt, and a model that is not told so judges the whole document by
 * whichever section happens to survive. Complete input gets an empty note, so
 * prompts for short documents are unchanged.
 *
 * @param text Extracted text as received from the pipeline
 * @param pageInfo Page coverage of the text, when the writer recorded it
 * @returns Text to embed in the prompt and the note to place before it
 */
export function preparePromptInput(
  text: string,
  pageInfo?: PageInfo
): PromptInput {
  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);
  const omittedPages =
    pageInfo && pageInfo.includedPages < pageInfo.totalPages
      ? pageInfo
      : undefined;
  const charactersCut = text.length > MAX_TEXT_LENGTH;

  if (!omittedPages && !charactersCut) {
    return { text: truncatedText, partialInputNote: '' };
  }

  let coverage: string;
  if (omittedPages && charactersCut) {
    coverage = `この文書は全${omittedPages.totalPages}ページです。以下は先頭${omittedPages.includedPages}ページのテキストのうち冒頭${MAX_TEXT_LENGTH}文字のみで、以降は省略されています。`;
  } else if (omittedPages) {
    coverage = `この文書は全${omittedPages.totalPages}ページです。以下は先頭${omittedPages.includedPages}ページのテキストのみで、以降は省略されています。`;
  } else {
    coverage = `以下は文書テキストの冒頭${MAX_TEXT_LENGTH}文字のみで、以降は省略されています。`;
  }

  const partialInputNote = `【注意：テキストは一部のみ】
${coverage}
テキストは抜粋として扱い、文書の種類はタイトル・表紙・目次などから判断してください。たまたま含まれている一部のセクションの内容だけで判断しないでください。省略が判断に影響した場合は reasoning にその旨を記してください。

`;

  return { text: truncatedText, partialInputNote };
}
