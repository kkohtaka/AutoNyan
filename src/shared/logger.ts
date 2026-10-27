// Thin structured logger for Cloud Functions.
//
// Emits one JSON object per line to stdout (stderr for ERROR). The Cloud
// Functions runtime forwards stdout/stderr to Cloud Logging, which natively
// parses the `severity` and `message` keys — so log level and displayed text
// come through without a Cloud Logging API client. A direct client is
// intentionally avoided: it adds latency and can drop logs when a short-lived
// function exits before the write flushes.

import { AsyncLocalStorage } from 'node:async_hooks';

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

// The second argument the Functions Framework passes to a legacy-signature
// event handler. Only the event ID is consumed: it is the Pub/Sub message ID or
// the CloudEvent ID, and it stays the same across retries, so one query on it
// shows every attempt.
export interface EventHandlerContext {
  eventId?: string;
}

// Cloud Logging merges this key into the entry's labels. The Functions
// Framework writes execution_id under the same key, so adding event_id here
// gives each line both without any client.
const CLOUD_LOGGING_LABELS_KEY = 'logging.googleapis.com/labels';

const eventContextStorage = new AsyncLocalStorage<EventHandlerContext>();

/**
 * Run a handler with its event's ID available to every log line and failure
 * notification it produces, however deep in the call stack.
 *
 * The returned function keeps an arity of 2: the framework treats a
 * legacy-signature handler with more than two parameters as callback-style
 * and would never resolve it.
 * @param handler Event handler taking the event payload alone
 * @returns Handler that accepts the framework's (data, context) pair
 */
export function withEventContext<TData, TResult>(
  handler: (data: TData) => Promise<TResult>
): (data: TData, context?: EventHandlerContext) => Promise<TResult> {
  return (data, context) =>
    eventContextStorage.run({ eventId: context?.eventId }, () => handler(data));
}

/**
 * Read the ID of the event the current handler invocation is processing
 * @returns The event ID, or undefined outside a wrapped handler
 */
export function currentEventId(): string | undefined {
  return eventContextStorage.getStore()?.eventId;
}

// JSON.stringify drops Error instances to `{}` because their properties are
// non-enumerable. Normalize them so error context is not silently lost.
function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function normalizeContext(
  context: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function write(
  severity: LogSeverity,
  message: string,
  context?: Record<string, unknown>
): void {
  const eventId = currentEventId();
  const entry: Record<string, unknown> = {
    severity,
    message,
    ...(context ? normalizeContext(context) : {}),
    ...(eventId ? { [CLOUD_LOGGING_LABELS_KEY]: { event_id: eventId } } : {}),
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (severity === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>): void =>
    write('DEBUG', message, context),
  info: (message: string, context?: Record<string, unknown>): void =>
    write('INFO', message, context),
  warn: (message: string, context?: Record<string, unknown>): void =>
    write('WARNING', message, context),
  error: (message: string, context?: Record<string, unknown>): void =>
    write('ERROR', message, context),
};
