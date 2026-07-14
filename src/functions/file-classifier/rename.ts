import { VertexAI } from '@google-cloud/vertexai';

export interface FileNameGenerationResult {
  fileName: string;
  confidence: number;
  reasoning: string;
}

interface GeminiFileNameResponse {
  fileName: string;
  confidence: number;
  reasoning: string;
}

const MAX_TEXT_LENGTH = 3000;

// Below this confidence the generated name is discarded and the file keeps
// its original name.
export const RENAME_CONFIDENCE_THRESHOLD = 0.7;

// Drive accepts far longer names, but very long names are unreadable in its UI.
const MAX_BASE_NAME_LENGTH = 100;

/**
 * Generate a content-derived file name using Gemini AI
 * @param projectId GCP Project ID
 * @param text Extracted text from document
 * @param originalFileName Current name of the file
 * @param existingFileNames File names already in the destination folder (most-recent first)
 * @returns Proposed base name (without extension), confidence, and reasoning
 */
export async function generateFileName(
  projectId: string,
  text: string,
  originalFileName: string,
  existingFileNames: string[]
): Promise<FileNameGenerationResult> {
  // Use region from environment variable, fallback to us-central1 if not set
  const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

  const vertexAI = new VertexAI({
    project: projectId,
    location: location,
  });

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
  });

  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);

  const existingNamesSection =
    existingFileNames.length > 0
      ? `【移動先フォルダの既存ファイル名（新しい順）】
${existingFileNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}

`
      : '';

  const namingInstruction =
    existingFileNames.length > 0
      ? '- 既存ファイル名から命名規則（日付の接頭辞、区切り文字、言語など）を推測し、それに合わせた名前を提案してください'
      : '- 移動先フォルダにはまだファイルがないため、文書の内容だけから簡潔な名前を提案してください';

  const prompt = `
あなたはファイル命名の専門家です。以下の文書に、内容がわかる簡潔なファイル名を付けてください。

【元のファイル名】
${originalFileName}

${existingNamesSection}【文書テキスト】
${truncatedText}

【指示】
${namingInstruction}
- 拡張子は含めないでください（元の拡張子がシステム側で付与されます）
- 回答は以下のJSON形式で出力してください：

{
  "fileName": "提案するファイル名（拡張子なし）",
  "confidence": 0.95,
  "reasoning": "命名理由の簡潔な説明"
}

注意: confidence は 0.0 から 1.0 の範囲の数値で、提案の確信度を表してください。
`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!responseText) {
    throw new Error('No response from Gemini API');
  }

  return parseGeminiResponse(responseText);
}

/**
 * Parse JSON response from Gemini, extracting JSON block if wrapped in markdown
 * @param responseText Raw response text from Gemini
 * @returns Parsed file name generation data
 */
function parseGeminiResponse(responseText: string): GeminiFileNameResponse {
  // Extract JSON from markdown code block if present
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  // Try to find JSON object in the text
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new Error('No JSON object found in Gemini response');
  }

  const parsed = JSON.parse(objectMatch[0]) as GeminiFileNameResponse;

  // Validate response structure
  if (
    typeof parsed.fileName !== 'string' ||
    typeof parsed.confidence !== 'number' ||
    typeof parsed.reasoning !== 'string'
  ) {
    throw new Error('Invalid response structure from Gemini');
  }

  // Ensure confidence is in valid range
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

  return parsed;
}

/**
 * Strip characters that are awkward in Drive file names and cap the length
 * @param name Raw base name proposed by Gemini
 * @returns Sanitized base name (may be empty)
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[/\\]/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, MAX_BASE_NAME_LENGTH)
      .trim()
  );
}

/**
 * Apply the rename guards to a generated name and produce the final file name
 *
 * Returns null when the file should keep its original name: confidence below
 * threshold, name empty after sanitization, or name identical to the original.
 * Collisions with existing names get a numeric suffix.
 *
 * @param generated Result of generateFileName
 * @param originalFileName Current name of the file (extension source)
 * @param existingFileNames File names already in the destination folder
 * @returns Final file name with extension, or null to keep the original name
 */
export function resolveRenamedFileName(
  generated: FileNameGenerationResult,
  originalFileName: string,
  existingFileNames: string[]
): string | null {
  if (generated.confidence < RENAME_CONFIDENCE_THRESHOLD) {
    return null;
  }

  const extensionMatch = originalFileName.match(/\.[^.]+$/);
  const extension = extensionMatch ? extensionMatch[0] : '';

  let baseName = sanitizeFileName(generated.fileName);

  // The prompt tells the model to omit the extension; strip it defensively so
  // a disobedient response does not yield "name.pdf.pdf".
  if (extension && baseName.toLowerCase().endsWith(extension.toLowerCase())) {
    baseName = baseName.slice(0, -extension.length).trim();
  }

  if (!baseName) {
    return null;
  }

  let candidate = `${baseName}${extension}`;

  const existingNames = new Set(existingFileNames);
  for (let suffix = 2; existingNames.has(candidate); suffix++) {
    candidate = `${baseName}-${suffix}${extension}`;
  }

  return candidate === originalFileName ? null : candidate;
}
