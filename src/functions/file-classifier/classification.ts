import { VertexAI } from '@google-cloud/vertexai';
import { CategoryFolder } from './drive-operations';

export interface ClassificationResult {
  categoryName: string | null;
  categoryFolderId: string | null;
  confidence: number;
  reasoning: string;
}

interface GeminiResponse {
  category: string;
  confidence: number;
  reasoning: string;
}

const UNCATEGORIZED = 'UNCATEGORIZED';
const MAX_TEXT_LENGTH = 3000;

/**
 * Classify document text using Gemini AI
 * @param projectId GCP Project ID
 * @param text Extracted text from document
 * @param categories Available category folders
 * @returns Classification result with category, confidence, and reasoning
 */
export async function classifyWithGemini(
  projectId: string,
  text: string,
  categories: CategoryFolder[]
): Promise<ClassificationResult> {
  const vertexAI = new VertexAI({
    project: projectId,
    location: 'us-central1',
  });

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
  });

  const categoriesList = categories
    .map((c, i) => `${i + 1}. ${c.name}`)
    .join('\n');

  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);

  const prompt = `
あなたは文書分類の専門家です。以下のテキスト内容を分析し、最も適切なカテゴリーを選択してください。

【利用可能なカテゴリー】
${categoriesList}

【文書テキスト】
${truncatedText}

【指示】
- 上記のカテゴリーから最も適切なものを1つ選んでください
- どのカテゴリーにも当てはまらない場合は "${UNCATEGORIZED}" と答えてください
- 回答は以下のJSON形式で出力してください：

{
  "category": "選択したカテゴリー名",
  "confidence": 0.95,
  "reasoning": "選択理由の簡潔な説明"
}

注意: confidence は 0.0 から 1.0 の範囲の数値で、分類の確信度を表してください。
`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!responseText) {
    throw new Error('No response from Gemini API');
  }

  const parsed = parseGeminiResponse(responseText);

  // Find matching category folder
  const categoryFolder = categories.find((c) => c.name === parsed.category);

  if (!categoryFolder && parsed.category !== UNCATEGORIZED) {
    // Category name returned by Gemini doesn't match any folder
    return {
      categoryName: null,
      categoryFolderId: null,
      confidence: 0,
      reasoning: `Category "${parsed.category}" not found in available folders`,
    };
  }

  return {
    categoryName: categoryFolder ? parsed.category : null,
    categoryFolderId: categoryFolder?.id || null,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}

/**
 * Parse JSON response from Gemini, extracting JSON block if wrapped in markdown
 * @param responseText Raw response text from Gemini
 * @returns Parsed classification data
 */
function parseGeminiResponse(responseText: string): GeminiResponse {
  // Extract JSON from markdown code block if present
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  // Try to find JSON object in the text
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new Error('No JSON object found in Gemini response');
  }

  const parsed = JSON.parse(objectMatch[0]) as GeminiResponse;

  // Validate response structure
  if (
    typeof parsed.category !== 'string' ||
    typeof parsed.confidence !== 'number' ||
    typeof parsed.reasoning !== 'string'
  ) {
    throw new Error('Invalid response structure from Gemini');
  }

  // Ensure confidence is in valid range
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

  return parsed;
}
