import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { PubSub } from '@google-cloud/pubsub';
import { calendarRegistrar } from './index';
import { ExtractedEvent } from './extraction';

const mockSet = jest.fn();
// Mirrors the Firestore shape closely enough to assert on the document ID the
// function derives for each event.
const mockDoc = jest.fn((eventId: string) => ({ id: eventId, set: mockSet }));
const mockCollection = jest.fn((path: string) => ({
  id: path,
  doc: mockDoc,
}));

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => ({ collection: mockCollection })),
}));

jest.mock('@google-cloud/pubsub');
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

jest.mock('./extraction', () => {
  const actual = jest.requireActual('./extraction');
  return { ...actual, extractEventsWithGemini: jest.fn() };
});

jest.mock('./calendar', () => {
  const actual = jest.requireActual('./calendar');
  return {
    ...actual,
    createCalendarClient: jest.fn(() => ({ mockCalendarClient: true })),
    registerEvent: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const extraction = require('./extraction');
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const calendar = require('./calendar');

const MAPPED_CATEGORY = '学校';
const CATEGORY_FOLDER = 'category-folder-id';
const CALENDAR_ID = 'family@group.calendar.google.com';

const createPubSubEvent = (
  data: Record<string, unknown>
): CloudEvent<MessagePublishedData> => ({
  specversion: '1.0',
  id: 'test-event-id',
  source: 'test-source',
  type: 'google.cloud.pubsub.topic.v1.messagePublished',
  time: new Date().toISOString(),
  data: {
    data: Buffer.from(JSON.stringify(data)).toString('base64'),
    message_id: 'test-message-id',
    publish_time: new Date().toISOString(),
  } as unknown as MessagePublishedData,
});

const baseMessage = {
  firestoreDocId: 'doc-1',
  fileId: 'file-1',
  fileName: '5月号学級通信.pdf',
  extractedText: '5月の予定',
  category: MAPPED_CATEGORY,
  categoryFolderId: CATEGORY_FOLDER,
  classificationConfidence: 0.95,
  modifiedTime: '2026-04-28T00:00:00.000Z',
};

const event = (
  title: string,
  date: string,
  confidence = 0.9
): ExtractedEvent => ({
  title,
  date,
  confidence,
});

describe('calendarRegistrar', () => {
  let mockPublishMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPublishMessage = jest.fn().mockResolvedValue('message-id');
    mockPubSub.mockImplementation(
      () =>
        ({
          topic: jest.fn().mockReturnValue({
            publishMessage: mockPublishMessage,
          }),
        }) as never
    );

    mockSet.mockResolvedValue(undefined);
    calendar.registerEvent.mockResolvedValue('created');

    process.env.PROJECT_ID = 'test-project';
    process.env.NOTIFICATION_TOPIC = 'notification-topic';
    process.env.CALENDAR_CATEGORY_CALENDARS = JSON.stringify([
      { category: MAPPED_CATEGORY, calendar_id: CALENDAR_ID },
    ]);
  });

  afterEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.NOTIFICATION_TOPIC;
    delete process.env.CALENDAR_CATEGORY_CALENDARS;
    delete process.env.CALENDAR_CLASSIFICATION_CONFIDENCE_THRESHOLD;
  });

  it('should register every event of a month-long newsletter and send one mail', async () => {
    const events = Array.from({ length: 23 }, (_, i) =>
      event(`予定${i + 1}`, `2026-05-${String(i + 1).padStart(2, '0')}`)
    );
    extraction.extractEventsWithGemini.mockResolvedValue({
      events,
      truncated: false,
    });

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.registered).toBe(23);
    expect(result.calendarId).toBe(CALENDAR_ID);
    expect(calendar.registerEvent).toHaveBeenCalledTimes(23);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);

    const published = mockPublishMessage.mock.calls[0][0];
    expect(published.attributes.operation).toBe('calendar-notification');
    expect(published.json.registeredEvents).toHaveLength(23);
    expect(published.json.categoryFolderId).toBe(CATEGORY_FOLDER);
    expect(published.json.category).toBe(MAPPED_CATEGORY);
  });

  it('should discard an unmapped category before extracting', async () => {
    const result = await calendarRegistrar(
      createPubSubEvent({ ...baseMessage, category: '自治会' })
    );

    expect(result.skipped).toBe(true);
    expect(extraction.extractEventsWithGemini).not.toHaveBeenCalled();
    expect(mockPublishMessage).not.toHaveBeenCalled();
  });

  it('should discard an Uncategorized document before extracting', async () => {
    const result = await calendarRegistrar(
      createPubSubEvent({ ...baseMessage, category: null })
    );

    expect(result.skipped).toBe(true);
    expect(extraction.extractEventsWithGemini).not.toHaveBeenCalled();
  });

  it('should discard a low-confidence classification before extracting', async () => {
    const result = await calendarRegistrar(
      createPubSubEvent({ ...baseMessage, classificationConfidence: 0.4 })
    );

    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/classification confidence/);
    expect(extraction.extractEventsWithGemini).not.toHaveBeenCalled();
  });

  it('should honour a configured classification confidence threshold', async () => {
    process.env.CALENDAR_CLASSIFICATION_CONFIDENCE_THRESHOLD = '0.99';

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.skipped).toBe(true);
    expect(extraction.extractEventsWithGemini).not.toHaveBeenCalled();
  });

  it('should pass the document modified time as the extraction reference date', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [event('遠足', '2026-05-16')],
      truncated: false,
    });

    await calendarRegistrar(createPubSubEvent(baseMessage));

    const referenceDate = extraction.extractEventsWithGemini.mock.calls[0][2];
    expect(referenceDate.toISOString()).toBe('2026-04-28T00:00:00.000Z');
  });

  it('should fall back to today as the reference date when the message has no modified time', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [],
      truncated: false,
    });
    // JSON.stringify drops the undefined field from the message body.
    const withoutModifiedTime = { ...baseMessage, modifiedTime: undefined };

    const before = Date.now();
    await calendarRegistrar(createPubSubEvent(withoutModifiedTime));

    const referenceDate = extraction.extractEventsWithGemini.mock.calls[0][2];
    expect(referenceDate.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('should register confident events and report the ones dropped for low confidence', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [event('遠足', '2026-05-16'), event('未確定', '2026-05-18', 0.3)],
      truncated: false,
    });

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.registered).toBe(1);
    expect(result.dropped).toBe(1);

    const published = mockPublishMessage.mock.calls[0][0];
    expect(published.json.registeredEvents).toHaveLength(1);
    expect(published.json.droppedEvents[0].title).toBe('未確定');
  });

  it('should fail the document without registering anything when the event cap is exceeded', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: Array.from({ length: 51 }, (_, i) =>
        event(`予定${i}`, '2026-05-16')
      ),
      truncated: false,
    });

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.skipped).toBe(true);
    expect(calendar.registerEvent).not.toHaveBeenCalled();
    expect(mockPublishMessage.mock.calls[0][0].attributes.operation).toBe(
      'failure-notification'
    );
  });

  it('should report truncation to the recipient', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [event('遠足', '2026-05-16')],
      truncated: true,
    });

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.truncated).toBe(true);
    expect(mockPublishMessage.mock.calls[0][0].json.truncated).toBe(true);
  });

  it('should send no mail when a reprocess registered no new event', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [event('遠足', '2026-05-16')],
      truncated: false,
    });
    calendar.registerEvent.mockResolvedValue('duplicate');

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.registered).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.notified).toBe(false);
    expect(mockPublishMessage).not.toHaveBeenCalled();
  });

  it('should record every event in the audit collection keyed by its event ID', async () => {
    extraction.extractEventsWithGemini.mockResolvedValue({
      events: [event('遠足', '2026-05-16')],
      truncated: false,
    });

    await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(mockCollection).toHaveBeenCalledWith('calendar_events');
    expect(mockDoc.mock.calls[0][0]).toMatch(/^[0-9a-v]{26}$/);
    expect(mockSet.mock.calls[0][0]).toMatchObject({
      calendarId: CALENDAR_ID,
      category: MAPPED_CATEGORY,
      fileId: 'file-1',
      title: '遠足',
      status: 'created',
    });
  });

  it('should skip permanently when required fields are missing', async () => {
    const result = await calendarRegistrar(
      createPubSubEvent({ fileId: 'file-1' })
    );

    expect(result.skipped).toBe(true);
    expect(extraction.extractEventsWithGemini).not.toHaveBeenCalled();
  });

  it('should rethrow a transient failure so the message is retried', async () => {
    extraction.extractEventsWithGemini.mockRejectedValue(
      new Error('Vertex AI unavailable')
    );

    await expect(
      calendarRegistrar(createPubSubEvent(baseMessage))
    ).rejects.toThrow(/Calendar registration failed/);
  });

  it('should skip when no category mapping is configured', async () => {
    delete process.env.CALENDAR_CATEGORY_CALENDARS;

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.skipped).toBe(true);
  });

  it('should fail permanently when the category mapping is not valid JSON', async () => {
    process.env.CALENDAR_CATEGORY_CALENDARS = 'not-json';

    const result = await calendarRegistrar(createPubSubEvent(baseMessage));

    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/not valid JSON/);
  });
});
