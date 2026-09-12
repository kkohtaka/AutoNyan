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

interface CalendarRegistrationEventData extends Record<string, unknown> {
  firestoreDocId: string;
  fileId: string;
  fileName: string;
  extractedText: string;
  sourceFolderId?: string;
  modifiedTime?: string;
}

export interface WatchFolder {
  folder_id: string;
  calendar_id: string;
  label: string;
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

const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const DEFAULT_EVENT_DURATION_MINUTES = 60;

/**
 * Read the folder-to-calendar mapping this deployment watches
 * @returns The configured watch folders, empty when none are configured
 */
export function parseWatchFolders(): WatchFolder[] {
  const raw = process.env.CALENDAR_WATCH_FOLDERS;
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PermanentError(
      `CALENDAR_WATCH_FOLDERS is not valid JSON: ${String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new PermanentError('CALENDAR_WATCH_FOLDERS must be a JSON array');
  }

  return parsed.filter((entry): entry is WatchFolder => {
    const candidate = entry as WatchFolder;
    return (
      typeof candidate?.folder_id === 'string' &&
      typeof candidate?.calendar_id === 'string'
    );
  });
}

/**
 * Cloud Function triggered by PubSub after extracted text is stored.
 * Extracts events from documents in watched Drive folders and registers them
 * on the calendar configured for that folder.
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

    // Discarding unwatched documents here, before any billable call, is what
    // lets text-firebase-writer publish every document without knowing which
    // folders map to a calendar.
    const watchFolders = parseWatchFolders();
    const watchFolder = watchFolders.find(
      (folder) => folder.folder_id === eventData.sourceFolderId
    );

    if (!watchFolder) {
      logger.info('Document is not from a watched folder, skipping', {
        fileName: eventData.fileName,
        sourceFolderId: eventData.sourceFolderId,
      });
      return {
        message: `Skipped (folder not watched): ${eventData.fileName}`,
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

    const timeZone = process.env.CALENDAR_TIME_ZONE || DEFAULT_TIME_ZONE;
    const durationMinutes = parseInt(
      process.env.CALENDAR_DEFAULT_EVENT_DURATION_MINUTES ||
        String(DEFAULT_EVENT_DURATION_MINUTES),
      10
    );

    // Without the document's own date the model resolves year-less dates
    // against its training cutoff.
    const referenceDate = eventData.modifiedTime
      ? new Date(eventData.modifiedTime)
      : new Date();

    logger.info('Extracting calendar events', {
      fileName: eventData.fileName,
      calendarLabel: watchFolder.label,
    });

    const extraction = await extractEventsWithGemini(
      getProjectId(),
      eventData.extractedText,
      referenceDate,
      timeZone
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
        watchFolder.calendar_id,
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
        calendarId: watchFolder.calendar_id,
        calendarLabel: watchFolder.label,
        firestoreDocId: eventData.firestoreDocId,
        fileId: eventData.fileId,
        fileName: eventData.fileName,
        sourceFolderId: watchFolder.folder_id,
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
      watchFolder,
      registered,
      dropped,
      extraction.truncated
    );

    const result = {
      message: `Registered ${registered.length} event(s) from ${eventData.fileName} on ${watchFolder.label}`,
      fileId: eventData.fileId,
      fileName: eventData.fileName,
      calendarId: watchFolder.calendar_id,
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

async function publishNotification(
  eventData: CalendarRegistrationEventData,
  watchFolder: WatchFolder,
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
        sourceFolderId: watchFolder.folder_id,
        calendarId: watchFolder.calendar_id,
        calendarLabel: watchFolder.label,
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
