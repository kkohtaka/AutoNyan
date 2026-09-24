import { Firestore } from '@google-cloud/firestore';
import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  createErrorResponse,
  getProjectId,
  isPermanentError,
  logger,
  parsePubSubEvent,
  PermanentError,
  validateRequiredFields,
} from 'autonyan-shared';
import {
  buildCalendarEvent,
  createCalendarClient,
  registerEvent,
} from './calendar';
import {
  ExtractedEvent,
  extractEventsWithGemini,
  MAX_EVENTS_PER_DOCUMENT,
} from './extraction';
import { loadSourceDocument } from './source-document';

interface CalendarRegistrationEventData extends Record<string, unknown> {
  firestoreDocId: string;
  fileId: string;
  fileName: string;
  extractedText: string;
  // Null when the classifier matched no category; such a document is filed as
  // Uncategorized and never maps to a calendar.
  category?: string | null;
  categoryFolderId?: string;
  classificationConfidence?: number;
  modifiedTime?: string;
  // The source file in the document-storage bucket, which keeps the layout
  // the OCR text loses.
  objectName?: string;
}

export interface CategoryCalendar {
  category: string;
  calendar_id: string;
}

interface Result {
  message: string;
  fileId: string;
  fileName: string;
  calendarId: string | null;
  registered: number;
  duplicates: number;
  dropped: number;
  truncated: boolean;
  notified: boolean;
  skipped?: boolean;
}

// Events below this are reported to the recipient instead of registered. The
// threshold is applied per event so one doubtful entry cannot discard a whole
// newsletter.
const CONFIDENCE_THRESHOLD = 0.7;

// Registration hangs off the classifier's judgement, and events are never
// updated or deleted, so a misclassification has to be undone by hand. A
// doubtful classification registers nothing rather than risk that.
const DEFAULT_CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.7;

const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const DEFAULT_EVENT_DURATION_MINUTES = 60;

/**
 * Read the category-to-calendar mapping this deployment registers on
 * @returns The configured mappings, empty when none are configured
 */
export function parseCategoryCalendars(): CategoryCalendar[] {
  const raw = process.env.CALENDAR_CATEGORY_CALENDARS;
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PermanentError(
      `CALENDAR_CATEGORY_CALENDARS is not valid JSON: ${String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new PermanentError(
      'CALENDAR_CATEGORY_CALENDARS must be a JSON array'
    );
  }

  return parsed.filter((entry): entry is CategoryCalendar => {
    const candidate = entry as CategoryCalendar;
    return (
      typeof candidate?.category === 'string' &&
      typeof candidate?.calendar_id === 'string'
    );
  });
}

/**
 * Cloud Function triggered by PubSub after a document is classified.
 * Extracts events from documents filed into a mapped category and registers
 * them on the calendar configured for that category.
 */
export const calendarRegistrar = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<Result> => {
  try {
    logger.info('Received PubSub event', { cloudEvent });

    const { data: eventData } =
      parsePubSubEvent<CalendarRegistrationEventData>(cloudEvent);

    validateRequiredFields(eventData, [
      'firestoreDocId',
      'fileId',
      'fileName',
      'extractedText',
    ]);

    // Both checks run before any billable call, which is what lets
    // file-classifier publish every classified document without knowing which
    // categories map to a calendar.
    const categoryCalendars = parseCategoryCalendars();
    const mapping = eventData.category
      ? categoryCalendars.find((entry) => entry.category === eventData.category)
      : undefined;

    if (!mapping) {
      logger.info('Document category is not mapped to a calendar, skipping', {
        fileName: eventData.fileName,
        category: eventData.category ?? null,
      });
      return skippedResult(
        `Skipped (category not mapped): ${eventData.fileName}`,
        eventData
      );
    }

    const classificationThreshold = parseFloat(
      process.env.CALENDAR_CLASSIFICATION_CONFIDENCE_THRESHOLD ||
        String(DEFAULT_CLASSIFICATION_CONFIDENCE_THRESHOLD)
    );
    const classificationConfidence = eventData.classificationConfidence ?? 0;

    if (classificationConfidence < classificationThreshold) {
      logger.info('Classification confidence below threshold, skipping', {
        fileName: eventData.fileName,
        category: eventData.category,
        classificationConfidence,
        classificationThreshold,
      });
      return skippedResult(
        `Skipped (classification confidence ${classificationConfidence} below ${classificationThreshold}): ${eventData.fileName}`,
        eventData
      );
    }

    const timeZone = process.env.CALENDAR_TIME_ZONE || DEFAULT_TIME_ZONE;
    const durationMinutes = parseInt(
      process.env.CALENDAR_DEFAULT_EVENT_DURATION_MINUTES ||
        String(DEFAULT_EVENT_DURATION_MINUTES),
      10
    );

    // Without the document's own date the model resolves year-less dates
    // against its training cutoff. Falling back to today is wrong by however
    // long the document has sat unprocessed, so the fallback is logged.
    if (!eventData.modifiedTime) {
      logger.warn('No modifiedTime on the message, using today as reference', {
        fileName: eventData.fileName,
      });
    }
    const referenceDate = eventData.modifiedTime
      ? new Date(eventData.modifiedTime)
      : new Date();

    const projectId = getProjectId();
    const sourceDocument = eventData.objectName
      ? await loadSourceDocument(
          documentBucketName(projectId),
          eventData.objectName
        )
      : null;

    logger.info('Extracting calendar events', {
      fileName: eventData.fileName,
      category: mapping.category,
      sourceDocument: sourceDocument?.mimeType ?? null,
    });

    const extraction = await extractEventsWithGemini(
      projectId,
      eventData.extractedText,
      referenceDate,
      timeZone,
      sourceDocument
    );

    if (extraction.events.length > MAX_EVENTS_PER_DOCUMENT) {
      throw new PermanentError(
        `Extracted ${extraction.events.length} events, above the per-document cap of ${MAX_EVENTS_PER_DOCUMENT}`
      );
    }

    const confident = extraction.events.filter(
      (event) => event.confidence >= CONFIDENCE_THRESHOLD
    );
    const dropped = extraction.events.filter(
      (event) => event.confidence < CONFIDENCE_THRESHOLD
    );

    logger.info('Extraction completed', {
      total: extraction.events.length,
      confident: confident.length,
      dropped: dropped.length,
      truncated: extraction.truncated,
    });

    const calendar = createCalendarClient();
    const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
    const firestore = new Firestore({ databaseId });
    const auditCollection = firestore.collection('calendar_events');

    const registered: ExtractedEvent[] = [];
    let duplicates = 0;

    for (const extracted of confident) {
      const event = buildCalendarEvent(
        extracted,
        eventData.fileId,
        durationMinutes
      );

      const status = await registerEvent(
        calendar,
        mapping.calendar_id,
        event,
        timeZone
      );

      if (status === 'created') {
        registered.push(extracted);
      } else {
        duplicates++;
      }

      // Keyed by the deterministic event ID so a re-scan rewrites the same
      // audit document instead of adding another.
      await auditCollection.doc(event.id).set({
        eventId: event.id,
        calendarId: mapping.calendar_id,
        category: mapping.category,
        firestoreDocId: eventData.firestoreDocId,
        fileId: eventData.fileId,
        fileName: eventData.fileName,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        confidence: event.confidence,
        status,
        registeredAt: new Date().toISOString(),
      });
    }

    // One mail per document, and none at all when a reprocess registered
    // nothing new, so a re-scan does not re-send what was already reported.
    const notified = await publishNotification(
      eventData,
      mapping,
      registered,
      dropped,
      extraction.truncated
    );

    const result = {
      message: `Registered ${registered.length} event(s) from ${eventData.fileName} on ${mapping.category}`,
      fileId: eventData.fileId,
      fileName: eventData.fileName,
      calendarId: mapping.calendar_id,
      registered: registered.length,
      duplicates,
      dropped: dropped.length,
      truncated: extraction.truncated,
      notified,
    };

    logger.info('Calendar registration completed', { result });

    return result;
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'calendarRegistrar');

    logger.error('Calendar registration error', { error: errorResponse });

    // Permanent failures: ACK (do not retry) to avoid repeated billable calls.
    if (isPermanentError(error)) {
      logger.warn('Skipping message (permanent failure, not retrying)', {
        error: errorResponse.error,
      });

      await publishFailureNotification(errorResponse.error);

      return {
        message: `Skipped (permanent failure): ${errorResponse.error}`,
        fileId: '',
        fileName: '',
        calendarId: null,
        registered: 0,
        duplicates: 0,
        dropped: 0,
        truncated: false,
        notified: false,
        skipped: true,
      };
    }

    // Transient failures: throw so RETRY_POLICY_RETRY retries the message.
    throw new Error(`Calendar registration failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};

function documentBucketName(projectId: string): string {
  const environment = process.env.ENVIRONMENT;
  if (!environment) {
    throw new Error('ENVIRONMENT environment variable is required but not set');
  }
  return `${projectId}-${environment}-document-storage`;
}

function skippedResult(
  message: string,
  eventData: CalendarRegistrationEventData
): Result {
  return {
    message,
    fileId: eventData.fileId,
    fileName: eventData.fileName,
    calendarId: null,
    registered: 0,
    duplicates: 0,
    dropped: 0,
    truncated: false,
    notified: false,
    skipped: true,
  };
}

async function publishNotification(
  eventData: CalendarRegistrationEventData,
  mapping: CategoryCalendar,
  registered: ExtractedEvent[],
  dropped: ExtractedEvent[],
  truncated: boolean
): Promise<boolean> {
  const notificationTopicName = process.env.NOTIFICATION_TOPIC;

  if (!notificationTopicName || registered.length === 0) {
    return false;
  }

  try {
    const pubsub = new PubSub();
    await pubsub.topic(notificationTopicName).publishMessage({
      json: {
        firestoreDocId: eventData.firestoreDocId,
        fileId: eventData.fileId,
        fileName: eventData.fileName,
        // The category folder's collaborators are the notification recipients.
        categoryFolderId: eventData.categoryFolderId,
        calendarId: mapping.calendar_id,
        category: mapping.category,
        registeredEvents: registered.map(toNotificationEvent),
        droppedEvents: dropped.map(toNotificationEvent),
        truncated,
      },
      attributes: {
        operation: 'calendar-notification',
        fileId: eventData.fileId,
      },
    });
    return true;
  } catch (notifyError) {
    // Non-fatal: the events are already on the calendar.
    logger.warn('Failed to publish calendar notification', {
      error: notifyError,
    });
    return false;
  }
}

function toNotificationEvent(event: ExtractedEvent): Record<string, unknown> {
  return {
    title: event.title,
    date: event.date,
    ...(event.startTime ? { startTime: event.startTime } : {}),
    ...(event.endTime ? { endTime: event.endTime } : {}),
    ...(event.location ? { location: event.location } : {}),
    confidence: event.confidence,
  };
}

async function publishFailureNotification(errorMessage: string): Promise<void> {
  const notificationTopicName = process.env.NOTIFICATION_TOPIC;
  if (!notificationTopicName) {
    return;
  }

  try {
    const pubsub = new PubSub();
    await pubsub.topic(notificationTopicName).publishMessage({
      json: {
        fileId: '',
        fileName: '',
        stageName: 'calendar-registrar',
        errorMessage,
      },
      attributes: { operation: 'failure-notification' },
    });
  } catch (notifyError) {
    logger.warn('Failed to publish failure notification', {
      error: notifyError,
    });
  }
}
