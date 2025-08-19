import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';

// Common interfaces for different event types
export interface PubSubMessage<T = Record<string, unknown>> {
  data: T;
  attributes?: Record<string, string>;
}

export interface StorageEventData {
  bucket: string;
  name: string;
  contentType?: string;
  size?: string;
  generation?: string;
  metadata?: Record<string, string>;
}

// Error classes for better error handling
export class ParameterParsingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ParameterParsingError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Parses PubSub CloudEvent data and returns typed message data
 * @param cloudEvent - The CloudEvent from PubSub trigger
 * @returns Parsed message data with optional attributes
 */
export function parsePubSubEvent<T = Record<string, unknown>>(
  cloudEvent: CloudEvent<MessagePublishedData>
): PubSubMessage<T> {
  try {
    // Validate CloudEvent structure
    if (!cloudEvent) {
      throw new ValidationError('CloudEvent is required');
    }

    if (!cloudEvent.data) {
      throw new ValidationError('CloudEvent data is required');
    }

    const rawData = cloudEvent.data;

    // Handle different data formats
    let decodedData: string;

    if (typeof rawData === 'string') {
      // PubSub messages are typically base64-encoded
      try {
        decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
      } catch (decodeError) {
        // If base64 decode fails, treat as plain string
        decodedData = rawData;
      }
    } else if (typeof rawData === 'object') {
      // Handle object data directly
      return {
        data: rawData as T,
        attributes: cloudEvent.source
          ? { source: cloudEvent.source }
          : undefined,
      };
    } else {
      throw new ValidationError(`Unsupported data type: ${typeof rawData}`);
    }

    // Parse JSON data
    let parsedData: T;
    try {
      parsedData = JSON.parse(decodedData);
    } catch (parseError) {
      throw new ParameterParsingError(
        'Failed to parse JSON data from PubSub message',
        parseError
      );
    }

    return {
      data: parsedData,
      attributes: cloudEvent.source ? { source: cloudEvent.source } : undefined,
    };
  } catch (error) {
    if (
      error instanceof ParameterParsingError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw new ParameterParsingError('Failed to parse PubSub CloudEvent', error);
  }
}

/**
 * Parses Storage CloudEvent data and returns storage event information
 * @param storageObjectData - The storage object data from CloudEvent
 * @returns Parsed storage event data
 */
export function parseStorageEvent(
  storageObjectData: StorageObjectData
): StorageEventData {
  try {
    // Validate storage object data
    if (!storageObjectData) {
      throw new ValidationError('StorageObjectData is required');
    }

    const { bucket, name, contentType, size, generation } = storageObjectData;

    if (!bucket) {
      throw new ValidationError('Storage bucket name is required', 'bucket');
    }

    if (!name) {
      throw new ValidationError('Storage object name is required', 'name');
    }

    return {
      bucket,
      name,
      contentType,
      size: size ? String(size) : undefined,
      generation: generation ? String(generation) : undefined,
      metadata: storageObjectData.metadata || undefined,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ParameterParsingError('Failed to parse Storage event', error);
  }
}

/**
 * Validates required fields in parsed data
 * @param data - The data object to validate
 * @param requiredFields - Array of required field names
 * @throws ValidationError if any required field is missing
 */
export function validateRequiredFields<T extends Record<string, unknown>>(
  data: T,
  requiredFields: (keyof T)[]
): void {
  const missingFields = requiredFields.filter(
    (field) =>
      data[field] === undefined || data[field] === null || data[field] === ''
  );

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(', ')}`,
      missingFields[0] as string
    );
  }
}

/**
 * Extracts environment variables with validation
 * @param envVars - Object mapping environment variable names to their required status
 * @returns Object with extracted environment variables
 */
export function getEnvironmentVariables<T extends Record<string, boolean>>(
  envVars: T
): Record<keyof T, string> {
  const result = {} as Record<keyof T, string>;
  const missing: string[] = [];

  for (const [envVar, required] of Object.entries(envVars)) {
    const value = process.env[envVar] || process.env[`GOOGLE_CLOUD_${envVar}`];

    if (!value && required) {
      missing.push(envVar);
    } else if (value) {
      result[envVar as keyof T] = value;
    }
  }

  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return result;
}

/**
 * Utility function to safely get project ID from various sources
 * @returns Project ID string
 */
export function getProjectId(): string {
  const projectId =
    process.env.PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;

  if (!projectId) {
    throw new ValidationError('PROJECT_ID environment variable is required');
  }

  return projectId;
}

/**
 * Creates a standardized error response for Cloud Functions
 * @param error - The error that occurred
 * @param context - Additional context about where the error occurred
 * @returns Formatted error object
 */
export function createErrorResponse(
  error: unknown,
  context: string
): { error: string; context: string; type: string } {
  let errorMessage: string;
  let errorType: string;

  if (error instanceof ParameterParsingError) {
    errorMessage = error.message;
    errorType = 'ParameterParsingError';
  } else if (error instanceof ValidationError) {
    errorMessage = error.message;
    errorType = 'ValidationError';
  } else if (error instanceof Error) {
    errorMessage = error.message;
    errorType = error.constructor.name;
  } else {
    errorMessage = 'Unknown error occurred';
    errorType = 'UnknownError';
  }

  return {
    error: errorMessage,
    context,
    type: errorType,
  };
}
