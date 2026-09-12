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

/**
 * Derive a Calendar event ID that is stable across re-scans and retries.
 *
 * Registration is therefore idempotent without any extra state: a repeat makes
 * events.insert return 409 rather than creating a second copy.
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
    .update(`${fileId}:${start}:${title}`)
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
 * Insert one event into a calendar
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

    // The calendar has not been shared with the service account; retrying
    // cannot fix that.
    if (status === 403 || status === 404) {
      throw new PermanentError(
        `Calendar ${calendarId} is not accessible (HTTP ${status}); share it with the function's service account`
      );
    }

    throw error;
  }
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
