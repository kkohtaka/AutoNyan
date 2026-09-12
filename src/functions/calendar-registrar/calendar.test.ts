import { PermanentError } from 'autonyan-shared';
import {
  buildCalendarEvent,
  buildEventId,
  registerEvent,
  CalendarEvent,
} from './calendar';
import { ExtractedEvent } from './extraction';

const allDayEvent: ExtractedEvent = {
  title: '運動会',
  date: '2026-05-16',
  confidence: 0.9,
};

const timedEvent: ExtractedEvent = {
  title: '保護者会',
  date: '2026-05-20',
  startTime: '14:00',
  confidence: 0.9,
};

describe('buildEventId', () => {
  it('should produce a base32hex ID of the length the Calendar API accepts', () => {
    const id = buildEventId('file-1', '2026-05-16', '運動会');
    expect(id).toMatch(/^[0-9a-v]{26}$/);
  });

  it('should be stable for the same document, start and title', () => {
    expect(buildEventId('file-1', '2026-05-16', '運動会')).toBe(
      buildEventId('file-1', '2026-05-16', '運動会')
    );
  });

  it('should differ when any input differs', () => {
    const base = buildEventId('file-1', '2026-05-16', '運動会');
    expect(buildEventId('file-2', '2026-05-16', '運動会')).not.toBe(base);
    expect(buildEventId('file-1', '2026-05-17', '運動会')).not.toBe(base);
    expect(buildEventId('file-1', '2026-05-16', '遠足')).not.toBe(base);
  });
});

describe('buildCalendarEvent', () => {
  it('should end an all-day event on the following day', () => {
    const event = buildCalendarEvent(allDayEvent, 'file-1', 60);
    expect(event.allDay).toBe(true);
    expect(event.start).toBe('2026-05-16');
    expect(event.end).toBe('2026-05-17');
  });

  it('should roll an all-day event at a month boundary into the next month', () => {
    const event = buildCalendarEvent(
      { ...allDayEvent, date: '2026-05-31' },
      'file-1',
      60
    );
    expect(event.end).toBe('2026-06-01');
  });

  it('should default a missing end time to the configured duration', () => {
    const event = buildCalendarEvent(timedEvent, 'file-1', 90);
    expect(event.allDay).toBe(false);
    expect(event.start).toBe('2026-05-20T14:00:00');
    expect(event.end).toBe('2026-05-20T15:30:00');
  });

  it('should use an explicit end time when the document gave one', () => {
    const event = buildCalendarEvent(
      { ...timedEvent, endTime: '16:30' },
      'file-1',
      60
    );
    expect(event.end).toBe('2026-05-20T16:30:00');
  });

  it('should carry the source file ID for traceability', () => {
    expect(buildCalendarEvent(allDayEvent, 'file-1', 60).sourceFileId).toBe(
      'file-1'
    );
  });
});

describe('registerEvent', () => {
  const event: CalendarEvent = {
    id: 'abcdefghijklmnopqrstuvabcd',
    title: '運動会',
    allDay: true,
    start: '2026-05-16',
    end: '2026-05-17',
    confidence: 0.9,
    sourceFileId: 'file-1',
  };

  const createCalendar = (insert: jest.Mock) =>
    ({ events: { insert } }) as never;

  it('should report a created event', async () => {
    const insert = jest.fn().mockResolvedValue({});
    const status = await registerEvent(
      createCalendar(insert),
      'calendar-1',
      event,
      'Asia/Tokyo'
    );

    expect(status).toBe('created');
    const requestBody = insert.mock.calls[0][0].requestBody;
    expect(requestBody.id).toBe(event.id);
    expect(requestBody.start).toEqual({ date: '2026-05-16' });
    expect(requestBody.end).toEqual({ date: '2026-05-17' });
    expect(requestBody.reminders).toEqual({ useDefault: true });
    expect(requestBody.extendedProperties.private.autonyanFileId).toBe(
      'file-1'
    );
  });

  it('should apply the time zone to a timed event', async () => {
    const insert = jest.fn().mockResolvedValue({});
    await registerEvent(
      createCalendar(insert),
      'calendar-1',
      {
        ...event,
        allDay: false,
        start: '2026-05-20T14:00:00',
        end: '2026-05-20T15:00:00',
      },
      'Asia/Tokyo'
    );

    const requestBody = insert.mock.calls[0][0].requestBody;
    expect(requestBody.start).toEqual({
      dateTime: '2026-05-20T14:00:00',
      timeZone: 'Asia/Tokyo',
    });
  });

  it('should treat 409 as success so a re-scan creates no duplicate', async () => {
    const insert = jest.fn().mockRejectedValue({ code: 409 });
    const status = await registerEvent(
      createCalendar(insert),
      'calendar-1',
      event,
      'Asia/Tokyo'
    );

    expect(status).toBe('duplicate');
  });

  it('should treat an unshared calendar as a permanent failure', async () => {
    const insert = jest.fn().mockRejectedValue({ code: 403 });

    await expect(
      registerEvent(createCalendar(insert), 'calendar-1', event, 'Asia/Tokyo')
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('should rethrow a transient failure so the message is retried', async () => {
    const insert = jest.fn().mockRejectedValue({ response: { status: 503 } });

    await expect(
      registerEvent(createCalendar(insert), 'calendar-1', event, 'Asia/Tokyo')
    ).rejects.not.toBeInstanceOf(PermanentError);
  });
});
