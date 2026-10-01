import { createHash } from 'crypto';
import { calendar_v3, google } from 'googleapis';
import { PermanentError } from 'autonyan-shared';
import { ExtractedEvent } from './extraction';

export interface CalendarEvent {
  // Deterministic ID, so a repeat of the same event collides instead of
  // duplicating. See buildEventId.
  id: string;
  title: string;
  allDay: boolean;
  // YYYY-MM-DD for an all-day event, YYYY-MM-DDTHH:MM:SS otherwise.
  start: string;
  end: string;
  location?: string;
  description?: string;
  confidence: number;
  // Written to the Calendar event so an event can be traced back to the
  // document it came from.
  sourceFileId: string;
}

export type RegistrationStatus = 'created' | 'duplicate';

// The Calendar API restricts event IDs to base32hex, i.e. the digits and the
// letters a-v.
const BASE32HEX_ALPHABET = '0123456789abcdefghijklmnopqrstuv';
const EVENT_ID_LENGTH = 26;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Brackets as a newsletter writes them: a qualifier such as 運動会（雨天延期）
// names the same event as 運動会, so what sits inside is dropped. Runs after
// NFKC, which has already folded the full-width pair into ASCII parentheses.
const BRACKETED_QUALIFIER =
  /[([{【〔《〈「『][^)\]}】〕》〉」』]*[)\]}】〕》〉」』]/gu;
const PUNCTUATION_OR_SPACE = /[\s\p{P}\p{S}]/gu;

// The lookup is an API call per event, so the response is bounded twice: by
// the file ID property and by a window around the event's date.
const LOOKUP_PAGE_SIZE = 250;

/**
 * Reduce a title to the form two extractions of the same event agree on.
 *
 * Gemini's wording for one event drifts between runs — spacing, full-width
 * versus half-width characters, a bracketed qualifier — and the ID hash and
 * the pre-insert lookup both have to see through that drift the same way.
 * @param title Event title as extracted
 * @returns Normalized title, or the trimmed original when nothing survives
 */
export function normalizeTitle(title: string): string {
  const normalized = title
    .normalize('NFKC')
    .replace(BRACKETED_QUALIFIER, '')
    .replace(PUNCTUATION_OR_SPACE, '')
    .toLowerCase();

  return normalized || title.trim().toLowerCase();
}

/**
 * Derive a Calendar event ID that is stable across re-scans and retries.
 *
 * Registration is therefore idempotent without any extra state: a repeat makes
 * events.insert return 409 rather than creating a second copy. The title is
 * normalized first so a reworded re-extraction lands on the same ID.
 * @param fileId Drive file ID of the source document
 * @param start Event start, as written into the Calendar event
 * @param title Event title
 * @returns Base32hex-encoded ID accepted by the Calendar API
 */
export function buildEventId(
  fileId: string,
  start: string,
  title: string
): string {
  const digest = createHash('sha256')
    .update(`${fileId}:${start}:${normalizeTitle(title)}`)
    .digest();

  let bits = 0;
  let value = 0;
  let encoded = '';

  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32HEX_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      if (encoded.length === EVENT_ID_LENGTH) {
        return encoded;
      }
    }
  }

  return encoded;
}

/**
 * Turn an extracted event into the shape the Calendar API is given
 * @param event Event as extracted from the document
 * @param fileId Drive file ID of the source document, for the event ID
 * @param defaultDurationMinutes Length given to a timed event with no end time
 * @returns Calendar event with a deterministic ID and a resolved end
 */
export function buildCalendarEvent(
  event: ExtractedEvent,
  fileId: string,
  defaultDurationMinutes: number
): CalendarEvent {
  const allDay = event.startTime === undefined;
  const start = allDay ? event.date : `${event.date}T${event.startTime}:00`;
  const end = allDay
    ? nextDay(event.date)
    : addMinutes(start, event.endTime, defaultDurationMinutes);

  return {
    id: buildEventId(fileId, start, event.title),
    title: event.title,
    allDay,
    start,
    end,
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
    confidence: event.confidence,
    sourceFileId: fileId,
  };
}

// The Calendar API treats an all-day event's end date as exclusive, so a
// one-day event ends on the following day.
function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`).getTime() + MS_PER_DAY;
  return new Date(next).toISOString().substring(0, 10);
}

function addMinutes(
  start: string,
  endTime: string | undefined,
  defaultDurationMinutes: number
): string {
  const date = start.substring(0, 10);
  if (endTime) {
    return `${date}T${endTime}:00`;
  }

  const ended =
    new Date(`${start}Z`).getTime() + defaultDurationMinutes * 60000;
  return new Date(ended).toISOString().substring(0, 19);
}

/**
 * Find an event already registered from the same document for the same start
 * and the same normalized title.
 *
 * The deterministic ID only catches a byte-identical repeat. An event whose
 * title was reworded by a re-extraction, or that was registered before titles
 * were normalized, carries a different ID and would otherwise be inserted
 * next to the original.
 * @param calendar Authenticated Calendar API client
 * @param calendarId Target calendar
 * @param event Event about to be inserted
 * @returns The matching registered event, or undefined when there is none
 */
export async function findRegisteredEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  event: CalendarEvent
): Promise<calendar_v3.Schema$Event | undefined> {
  const { timeMin, timeMax } = lookupWindow(event.start);
  const title = normalizeTitle(event.title);
  let pageToken: string | undefined;

  do {
    let response;
    try {
      response = await calendar.events.list({
        calendarId,
        privateExtendedProperty: [`autonyanFileId=${event.sourceFileId}`],
        timeMin,
        timeMax,
        singleEvents: true,
        maxResults: LOOKUP_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      });
    } catch (error) {
      throw translateAccessError(error, calendarId);
    }

    const match = response.data.items?.find(
      (item) =>
        eventStart(item) === event.start &&
        normalizeTitle(item.summary ?? '') === title
    );
    if (match) {
      return match;
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return undefined;
}

// The Calendar API filters on the event's own time zone, so the window is
// padded by a day on either side rather than converted; the exact-start match
// on the result keeps the extra day from mattering.
function lookupWindow(start: string): { timeMin: string; timeMax: string } {
  const day = new Date(`${start.substring(0, 10)}T00:00:00Z`).getTime();
  return {
    timeMin: new Date(day - MS_PER_DAY).toISOString(),
    timeMax: new Date(day + 2 * MS_PER_DAY).toISOString(),
  };
}

// A registered timed event comes back with its offset appended, which the
// start written at registration never carried.
function eventStart(item: calendar_v3.Schema$Event): string | undefined {
  if (item.start?.date) {
    return item.start.date;
  }
  return item.start?.dateTime?.substring(0, 19);
}

/**
 * Insert one event into a calendar unless an equivalent one is already there
 * @param calendar Authenticated Calendar API client
 * @param calendarId Target calendar
 * @param event Event to insert
 * @param timeZone IANA time zone applied to timed events
 * @returns 'duplicate' when the event was already registered, 'created' otherwise
 */
export async function registerEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  event: CalendarEvent,
  timeZone: string
): Promise<RegistrationStatus> {
  if (await findRegisteredEvent(calendar, calendarId, event)) {
    return 'duplicate';
  }

  const requestBody: calendar_v3.Schema$Event = {
    id: event.id,
    summary: event.title,
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
    start: event.allDay
      ? { date: event.start }
      : { dateTime: event.start, timeZone },
    end: event.allDay ? { date: event.end } : { dateTime: event.end, timeZone },
    extendedProperties: { private: { autonyanFileId: event.sourceFileId } },
    // The calendar owner's own reminder settings decide how they are notified.
    reminders: { useDefault: true },
  };

  try {
    await calendar.events.insert({ calendarId, requestBody });
    return 'created';
  } catch (error) {
    const status = errorStatus(error);

    // The deterministic ID already exists, which is exactly what it is for.
    if (status === 409) {
      return 'duplicate';
    }

    throw translateAccessError(error, calendarId);
  }
}

// The calendar has not been shared with the service account; retrying cannot
// fix that.
function translateAccessError(error: unknown, calendarId: string): unknown {
  const status = errorStatus(error);
  if (status === 403 || status === 404) {
    return new PermanentError(
      `Calendar ${calendarId} is not accessible (HTTP ${status}); share it with the function's service account`
    );
  }
  return error;
}

/**
 * Build a Calendar client authorized for event management only
 * @returns Authenticated Calendar API client
 */
export function createCalendarClient(): calendar_v3.Calendar {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  });
  return google.calendar({ version: 'v3', auth });
}

function errorStatus(error: unknown): number | undefined {
  const candidate = error as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };

  if (typeof candidate.code === 'number') {
    return candidate.code;
  }
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  return candidate.response?.status;
}
