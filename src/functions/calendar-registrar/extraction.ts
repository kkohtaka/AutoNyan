import { ResponseSchema, SchemaType, VertexAI } from '@google-cloud/vertexai';
import { PermanentError } from 'autonyan-shared';
import { SourceDocument } from './source-document';

// A lunch menu is reference information rather than an appointment, so the
// registrar renders it differently: it must neither block the day nor ring a
// reminder.
export type EventKind = 'event' | 'lunch_menu';

export interface ExtractedEvent {
  kind: EventKind;
  title: string;
  // Resolved calendar date of the event start, as YYYY-MM-DD.
  date: string;
  // 24-hour HH:MM, absent for an all-day event.
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  // Menu items with the main dish first; present only on a lunch_menu entry.
  items?: string[];
  confidence: number;
}

export interface ExtractionResult {
  events: ExtractedEvent[];
  truncated: boolean;
}

interface GeminiEvent {
  kind?: string | null;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  description?: string | null;
  items?: unknown[] | null;
  confidence: number;
}

// A monthly newsletter carries a whole month of events in one document, so the
// classifier's 3000-character limit would silently drop the second half of the
// month — and a missing event is indistinguishable from a document that had
// none.
const MAX_TEXT_LENGTH = 30000;

// A runaway model must not be able to flood a calendar. Documents above this
// are failed rather than partially registered.
export const MAX_EVENTS_PER_DOCUMENT = 50;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Registration is idempotent only as far as two extractions of one document
// agree, so sampling is turned off and the output shape is pinned; a field
// the model would have invented on one run and not the next is then absent on
// both.
const EXTRACTION_TEMPERATURE = 0;

const nullableString: ResponseSchema = {
  type: SchemaType.STRING,
  nullable: true,
};

export const EVENTS_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    events: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          kind: nullableString,
          title: { type: SchemaType.STRING },
          date: { type: SchemaType.STRING },
          startTime: nullableString,
          endTime: nullableString,
          location: nullableString,
          description: nullableString,
          items: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            nullable: true,
          },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ['title', 'date', 'confidence'],
      },
    },
  },
  required: ['events'],
};
const MONTH_DAY = /^\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Resolve a date the source document wrote without a year against the date the
 * document itself was written.
 *
 * School newsletters write "15日（水）" and leave the year implicit, so a
 * January entry in a March newsletter belongs to the following January.
 * @param date Either YYYY-MM-DD (used as is) or MM-DD
 * @param referenceDate Date the source document was last modified
 * @returns Date as YYYY-MM-DD
 */
export function resolveEventDate(date: string, referenceDate: Date): string {
  if (DATE_ONLY.test(date)) {
    return date;
  }

  if (!MONTH_DAY.test(date)) {
    throw new PermanentError(`Unsupported date format from Gemini: ${date}`);
  }

  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth() + 1;
  const month = parseInt(date.substring(0, 2), 10);

  const year = month < referenceMonth ? referenceYear + 1 : referenceYear;

  return `${year}-${date}`;
}

/**
 * Extract calendar events from document text using Gemini AI
 * @param projectId GCP Project ID
 * @param text Extracted text from the document
 * @param referenceDate Date the source document was last modified, used to
 *   resolve dates written without a year
 * @param timeZone IANA time zone the document's times are written in
 * @param sourceDocument The original file, when Gemini can read it
 * @returns The extracted events and whether the text had to be truncated
 */
export async function extractEventsWithGemini(
  projectId: string,
  text: string,
  referenceDate: Date,
  timeZone: string,
  sourceDocument: SourceDocument | null
): Promise<ExtractionResult> {
  const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

  const vertexAI = new VertexAI({
    project: projectId,
    location: location,
  });

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
  });

  const truncated = text.length > MAX_TEXT_LENGTH;
  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);
  const referenceDateText = referenceDate.toISOString().substring(0, 10);

  // OCR reads a calendar grid out of column order, so the text alone cannot
  // tell which day's cell an event sits in; only the original file can.
  const sourceInstruction = sourceDocument
    ? `
【原本】
添付ファイルはこの文書の原本です。【文書テキスト】は原本をOCRしたもので、表の行や列の並びが崩れている場合があります。予定の日付は必ず原本のレイアウト（カレンダー表ならその予定が書かれたマスの日付）から判断し、テキストは文字の読み取りの補助として使ってください。
`
    : '';

  const prompt = `
あなたは文書から予定を抽出する専門家です。以下の文書に含まれる予定をすべて抽出してください。
${sourceInstruction}
【基準日】
${referenceDateText}（この文書が作成された日。タイムゾーンは ${timeZone}）

【文書テキスト】
${truncatedText}

【指示】
- 日時が特定できる予定のみを抽出してください
- 予定が1件も無い場合は空の配列を返してください
- 年が明記されている場合は "YYYY-MM-DD"、年が書かれていない場合は "MM-DD" の形式で日付を出力してください（年を推測して補わないでください）
- 時刻が書かれていない終日の予定は startTime を null にしてください
- 時刻は24時間表記の "HH:MM" で出力してください
- 給食の献立（その日に提供される料理の一覧）は、1日分を1件として kind を "lunch_menu" にし、items に料理名を主菜から順に列挙してください。title には料理名を「、」で連結したものを入れてください。献立以外の予定は kind を "event" にし、items は null にしてください
- 回答は以下のJSON形式で出力してください：

{
  "events": [
    {
      "kind": "event",
      "title": "予定の名称",
      "date": "MM-DD",
      "startTime": "09:00",
      "endTime": null,
      "location": "場所",
      "description": "補足",
      "items": null,
      "confidence": 0.95
    },
    {
      "kind": "lunch_menu",
      "title": "ドライカレー、サラダ、みかん",
      "date": "MM-DD",
      "startTime": null,
      "endTime": null,
      "location": null,
      "description": null,
      "items": ["ドライカレー", "サラダ", "みかん"],
      "confidence": 0.95
    }
  ]
}

注意: confidence は 0.0 から 1.0 の範囲の数値で、抽出の確信度を表してください。
`;

  const parts = sourceDocument
    ? [{ inlineData: sourceDocument }, { text: prompt }]
    : [{ text: prompt }];

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: EXTRACTION_TEMPERATURE,
      responseMimeType: 'application/json',
      responseSchema: EVENTS_RESPONSE_SCHEMA,
    },
  });
  const responseText =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!responseText) {
    throw new PermanentError('No response from Gemini API');
  }

  const parsed = parseGeminiResponse(responseText);

  const events = parsed.map((event) => normalizeEvent(event, referenceDate));

  return { events, truncated };
}

function normalizeEvent(
  event: GeminiEvent,
  referenceDate: Date
): ExtractedEvent {
  const startTime = normalizeTime(event.startTime);
  const endTime = normalizeTime(event.endTime);
  const kind = normalizeKind(event.kind);
  const items = kind === 'lunch_menu' ? menuItems(event) : [];

  return {
    kind,
    title: event.title.trim(),
    date: resolveEventDate(event.date.trim(), referenceDate),
    ...(startTime ? { startTime } : {}),
    // An end time without a start time describes nothing a calendar can show.
    ...(startTime && endTime ? { endTime } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
    ...(items.length > 0 ? { items } : {}),
    confidence: Math.max(0, Math.min(1, event.confidence)),
  };
}

// An unknown kind is the model inventing a category; the entry is still a
// dated item, so it is kept as an ordinary event rather than dropped.
function normalizeKind(value: string | null | undefined): EventKind {
  return value === 'lunch_menu' ? 'lunch_menu' : 'event';
}

const MENU_SEPARATOR = /[、,，/／]/;

// The dishes are what the entry is rendered from, so a menu the model listed
// only in its title is split rather than left without any.
function menuItems(event: GeminiEvent): string[] {
  const listed = Array.isArray(event.items) ? event.items : [];
  const items = listed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length > 0) {
    return items;
  }
  return event.title
    .split(MENU_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTime(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return TIME_OF_DAY.test(trimmed) ? trimmed : undefined;
}

function parseGeminiResponse(responseText: string): GeminiEvent[] {
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new PermanentError('No JSON object found in Gemini response');
  }

  const parsed = JSON.parse(objectMatch[0]) as { events?: unknown };

  if (!Array.isArray(parsed.events)) {
    throw new PermanentError('Invalid response structure from Gemini');
  }

  return parsed.events.map((event) => {
    const candidate = event as GeminiEvent;
    if (
      typeof candidate.title !== 'string' ||
      typeof candidate.date !== 'string' ||
      typeof candidate.confidence !== 'number'
    ) {
      throw new PermanentError('Invalid event structure from Gemini');
    }
    return candidate;
  });
}
