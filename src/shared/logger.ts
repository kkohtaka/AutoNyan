// Thin structured logger for Cloud Functions.
//
// Emits one JSON object per line to stdout (stderr for ERROR). The Cloud
// Functions runtime forwards stdout/stderr to Cloud Logging, which natively
// parses the `severity` and `message` keys — so log level and displayed text
// come through without a Cloud Logging API client. A direct client is
// intentionally avoided: it adds latency and can drop logs when a short-lived
// function exits before the write flushes.

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

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
  const entry: Record<string, unknown> = {
    severity,
    message,
    ...(context ? normalizeContext(context) : {}),
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
