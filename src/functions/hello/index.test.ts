import { Request, Response } from 'express';
import { CloudEvent } from '@google-cloud/functions-framework';
import { helloWorld } from './index';

describe('helloWorld', () => {
  describe('HTTP request', () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let responseStatus: number;
    let responseBody: string;

    beforeEach(() => {
      responseStatus = 0;
      responseBody = '';

      mockRequest = {
        query: {}
      };

      mockResponse = {
        status: jest.fn().mockImplementation((status: number) => {
          responseStatus = status;
          return mockResponse;
        }),
        send: jest.fn().mockImplementation((body: string) => {
          responseBody = body;
          return mockResponse;
        })
      };
    });

    it('should return "Hello, World!" when no name is provided', () => {
      helloWorld(mockRequest as Request, mockResponse as Response);

      expect(responseStatus).toBe(200);
      expect(responseBody).toBe('Hello, World!');
    });

    it('should return "Hello, John!" when name is provided', () => {
      mockRequest.query = { name: 'John' };

      helloWorld(mockRequest as Request, mockResponse as Response);

      expect(responseStatus).toBe(200);
      expect(responseBody).toBe('Hello, John!');
    });
  });

  describe('CloudEvent request', () => {
    it('should return default message when no name is provided', async () => {
      const cloudEvent = {
        id: 'test-id',
        data: {}
      } as CloudEvent<{ name?: string }>;

      const result = await helloWorld(cloudEvent);

      expect(result).toEqual({
        message: 'Hello, World!'
      });
    });

    it('should return personalized message when name is provided', async () => {
      const cloudEvent = {
        id: 'test-id',
        data: {
          name: 'John'
        }
      } as CloudEvent<{ name?: string }>;

      const result = await helloWorld(cloudEvent);

      expect(result).toEqual({
        message: 'Hello, John!'
      });
    });
  });
});
