import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { StorageObjectData } from '@google/events/cloud/storage/v1/StorageObjectData';
import {
  parsePubSubEvent,
  parseStorageEvent,
  validateRequiredFields,
  getProjectId,
  createErrorResponse,
  ParameterParsingError,
  ValidationError,
  getEnvironmentVariables,
} from './parameter-parser';

describe('Parameter Parser', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parsePubSubEvent', () => {
    it('should parse base64-encoded PubSub message data', () => {
      const messageData = { testField: 'testValue' };
      const base64Data = Buffer.from(JSON.stringify(messageData)).toString(
        'base64'
      );

      const cloudEvent: CloudEvent<MessagePublishedData> = {
        specversion: '1.0',
        type: 'google.cloud.pubsub.topic.v1.messagePublished',
        source: 'test-source',
        id: 'test-id',
        time: '2023-01-01T00:00:00Z',
        data: base64Data,
      };

      const result = parsePubSubEvent(cloudEvent);

      expect(result.data).toEqual(messageData);
      expect(result.attributes).toEqual({ source: 'test-source' });
    });

    it('should handle object data directly', () => {
      const messageData = { testField: 'testValue' };

      const cloudEvent: CloudEvent<MessagePublishedData> = {
        specversion: '1.0',
        type: 'google.cloud.pubsub.topic.v1.messagePublished',
        source: 'test-source',
        id: 'test-id',
        time: '2023-01-01T00:00:00Z',
        data: messageData as any,
      };

      const result = parsePubSubEvent(cloudEvent);

      expect(result.data).toEqual(messageData);
    });

    it('should throw ValidationError for missing data', () => {
      const cloudEvent: CloudEvent<MessagePublishedData> = {
        specversion: '1.0',
        type: 'google.cloud.pubsub.topic.v1.messagePublished',
        source: 'test-source',
        id: 'test-id',
        time: '2023-01-01T00:00:00Z',
        data: null as any,
      };

      expect(() => parsePubSubEvent(cloudEvent)).toThrow(ValidationError);
    });

    it('should throw ParameterParsingError for invalid JSON', () => {
      const invalidBase64 = Buffer.from('invalid json').toString('base64');

      const cloudEvent: CloudEvent<MessagePublishedData> = {
        specversion: '1.0',
        type: 'google.cloud.pubsub.topic.v1.messagePublished',
        source: 'test-source',
        id: 'test-id',
        time: '2023-01-01T00:00:00Z',
        data: invalidBase64,
      };

      expect(() => parsePubSubEvent(cloudEvent)).toThrow(ParameterParsingError);
    });
  });

  describe('parseStorageEvent', () => {
    it('should parse storage event data', () => {
      const storageData: StorageObjectData = {
        bucket: 'test-bucket',
        name: 'test-object',
        contentType: 'application/json',
        size: 1024,
        generation: 123456,
        metadata: { key: 'value' },
      };

      const result = parseStorageEvent(storageData);

      expect(result).toEqual({
        bucket: 'test-bucket',
        name: 'test-object',
        contentType: 'application/json',
        size: '1024',
        generation: '123456',
        metadata: { key: 'value' },
      });
    });

    it('should throw ValidationError for missing bucket', () => {
      const storageData: StorageObjectData = {
        bucket: '',
        name: 'test-object',
      };

      expect(() => parseStorageEvent(storageData)).toThrow(ValidationError);
    });

    it('should throw ValidationError for missing object name', () => {
      const storageData: StorageObjectData = {
        bucket: 'test-bucket',
        name: '',
      };

      expect(() => parseStorageEvent(storageData)).toThrow(ValidationError);
    });
  });

  describe('validateRequiredFields', () => {
    it('should pass validation for valid data', () => {
      const data = { field1: 'value1', field2: 'value2' };

      expect(() =>
        validateRequiredFields(data, ['field1', 'field2'])
      ).not.toThrow();
    });

    it('should throw ValidationError for missing fields', () => {
      const data = { field1: 'value1' };

      expect(() => validateRequiredFields(data, ['field1', 'field2'])).toThrow(
        ValidationError
      );
    });

    it('should throw ValidationError for empty string fields', () => {
      const data = { field1: 'value1', field2: '' };

      expect(() => validateRequiredFields(data, ['field1', 'field2'])).toThrow(
        ValidationError
      );
    });
  });

  describe('getProjectId', () => {
    it('should return PROJECT_ID from environment', () => {
      process.env.PROJECT_ID = 'test-project-id';

      expect(getProjectId()).toBe('test-project-id');
    });

    it('should return GOOGLE_CLOUD_PROJECT from environment', () => {
      delete process.env.PROJECT_ID;
      process.env.GOOGLE_CLOUD_PROJECT = 'gcp-project-id';

      expect(getProjectId()).toBe('gcp-project-id');
    });

    it('should throw ValidationError when no project ID is set', () => {
      delete process.env.PROJECT_ID;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GCLOUD_PROJECT;

      expect(() => getProjectId()).toThrow(ValidationError);
    });
  });

  describe('getEnvironmentVariables', () => {
    it('should return environment variables', () => {
      process.env.VAR1 = 'value1';
      process.env.VAR2 = 'value2';

      const result = getEnvironmentVariables({
        VAR1: true,
        VAR2: false,
        VAR3: false,
      });

      expect(result).toEqual({
        VAR1: 'value1',
        VAR2: 'value2',
      });
    });

    it('should throw ValidationError for missing required variables', () => {
      delete process.env.VAR1;

      expect(() => getEnvironmentVariables({ VAR1: true })).toThrow(
        ValidationError
      );
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response for ParameterParsingError', () => {
      const error = new ParameterParsingError('Test parsing error');
      const result = createErrorResponse(error, 'testContext');

      expect(result).toEqual({
        error: 'Test parsing error',
        context: 'testContext',
        type: 'ParameterParsingError',
      });
    });

    it('should create error response for ValidationError', () => {
      const error = new ValidationError('Test validation error', 'testField');
      const result = createErrorResponse(error, 'testContext');

      expect(result).toEqual({
        error: 'Test validation error',
        context: 'testContext',
        type: 'ValidationError',
      });
    });

    it('should create error response for generic Error', () => {
      const error = new Error('Generic error');
      const result = createErrorResponse(error, 'testContext');

      expect(result).toEqual({
        error: 'Generic error',
        context: 'testContext',
        type: 'Error',
      });
    });

    it('should create error response for unknown error', () => {
      const error = 'string error';
      const result = createErrorResponse(error, 'testContext');

      expect(result).toEqual({
        error: 'Unknown error occurred',
        context: 'testContext',
        type: 'UnknownError',
      });
    });
  });
});
