import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Test Logger
 * Logs test execution progress to both console and file
 */
export class E2ELogger {
  private logFile: string;

  constructor(testName: string) {
    const logDir = path.join(process.cwd(), 'tests/e2e/logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, `${testName}-${Date.now()}.log`);
  }

  /**
   * Log a message
   *
   * @param stage - Pipeline stage
   * @param message - Log message
   * @param data - Optional data to log
   */
  log(stage: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      stage,
      message,
      data,
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.logFile, logLine);

    // Also log to console for real-time feedback
    console.log(`[${timestamp}] ${stage}: ${message}`, data || '');
  }

  /**
   * Log an error
   *
   * @param stage - Pipeline stage
   * @param error - Error object
   * @param context - Optional context
   */
  error(stage: string, error: Error, context?: unknown): void {
    this.log(stage, `ERROR: ${error.message}`, {
      stack: error.stack,
      context,
    });
  }

  /**
   * Get the log file path
   *
   * @returns Log file path
   */
  getLogFilePath(): string {
    return this.logFile;
  }
}
