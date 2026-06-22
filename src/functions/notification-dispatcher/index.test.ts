import { notificationDispatcher } from './index';
import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn(() => ({ mockGoogleAuthInstance: true })),
      JWT: jest.fn(() => ({ mockJWTInstance: true })),
    },
    drive: jest.fn(),
    gmail: jest.fn(),
  },
}));

jest.mock('autonyan-shared', () => ({
  parsePubSubEvent: jest.fn(),
  createErrorResponse: jest.fn((error: unknown, context: string) => ({
    error: error instanceof Error ? error.message : String(error),
    context,
    type: 'Error',
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const { parsePubSubEvent: mockParsePubSubEvent } = require('autonyan-shared');
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const { google } = require('googleapis');

const MOCK_SA_KEY = JSON.stringify({
  client_email: 'test-sa@test-project.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN RSA PRIVATE KEY-----\nMOCK_KEY\n-----END RSA PRIVATE KEY-----\n',
});

function decodeRawEmail(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

// Builds an event in the shape the runtime actually delivers: the message body
// is a base64-encoded string on cloudEvent.data, and the PubSub attributes are
// at the top level on cloudEvent.attributes.
const buildEvent = (
  data: Record<string, unknown>,
  attributes: Record<string, string> = {}
): CloudEvent<MessagePublishedData> =>
  ({
    specversion: '1.0',
    id: 'test-event-id',
    source: 'test-source',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    time: new Date().toISOString(),
    data: Buffer.from(JSON.stringify(data)).toString('base64'),
    attributes,
    message_id: 'test-message-id',
    publish_time: new Date().toISOString(),
  }) as unknown as CloudEvent<MessagePublishedData>;

describe('notificationDispatcher', () => {
  let mockPermissionsList: jest.Mock;
  let mockFilesGet: jest.Mock;
  let mockGmailSend: jest.Mock;
  let mockDrive: {
    permissions: { list: jest.Mock };
    files: { get: jest.Mock };
  };
  let mockGmail: { users: { messages: { send: jest.Mock } } };

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.NOTIFICATION_SA_KEY = MOCK_SA_KEY;
    process.env.NOTIFICATION_FROM_EMAIL = 'noreply@example.com';

    mockPermissionsList = jest.fn();
    mockFilesGet = jest.fn();
    mockGmailSend = jest.fn().mockResolvedValue({ data: { id: 'msg-123' } });

    mockDrive = {
      permissions: { list: mockPermissionsList },
      files: { get: mockFilesGet },
    };
    mockGmail = { users: { messages: { send: mockGmailSend } } };

    google.drive.mockReturnValue(mockDrive);
    google.gmail.mockReturnValue(mockGmail);
  });

  afterEach(() => {
    delete process.env.NOTIFICATION_SA_KEY;
    delete process.env.NOTIFICATION_FROM_EMAIL;
  });

  describe('success notification', () => {
    const successData = {
      firestoreDocId: 'doc-abc123',
      fileId: 'file-123',
      fileName: 'invoice.pdf',
      category: '請求書',
      confidence: 0.95,
      reasoning: 'Document contains invoice keywords',
      summary: 'This is a test invoice summary',
      destinationFolderId: 'dest-folder-id',
    };

    it('should send emails to destination folder viewers', async () => {
      mockParsePubSubEvent.mockReturnValue({ data: successData });

      mockPermissionsList.mockResolvedValue({
        data: {
          permissions: [
            { emailAddress: 'user1@example.com', role: 'reader', type: 'user' },
            { emailAddress: 'user2@example.com', role: 'writer', type: 'user' },
            { type: 'anyone', role: 'reader' },
          ],
        },
      });

      const event = buildEvent(successData, {
        operation: 'success-notification',
        fileId: 'file-123',
      });
      await notificationDispatcher(event);

      expect(mockPermissionsList).toHaveBeenCalledWith({
        fileId: 'dest-folder-id',
        fields: 'permissions(emailAddress,role,type)',
        supportsAllDrives: true,
      });

      expect(mockGmailSend).toHaveBeenCalledTimes(2);

      const firstCallRaw = mockGmailSend.mock.calls[0][0].requestBody
        .raw as string;
      const firstEmailDecoded = decodeRawEmail(firstCallRaw);
      expect(firstEmailDecoded).toContain('To: user1@example.com');
      expect(firstEmailDecoded).toContain('From: noreply@example.com');

      // Subject is encoded in RFC 2047 encoded-word format; decode the base64 part
      const subjectLine =
        firstEmailDecoded
          .split('\r\n')
          .find((l: string) => l.startsWith('Subject:')) || '';
      const subjectB64 =
        subjectLine.match(/=\?UTF-8\?B\?([^?]+)\?=/)?.[1] || '';
      const subject = Buffer.from(subjectB64, 'base64').toString('utf8');
      expect(subject).toContain('[AutoNyan]');

      // Body is base64 encoded; decode it
      const bodyB64 = firstEmailDecoded.split('\r\n\r\n')[1];
      const bodyDecoded = Buffer.from(bodyB64, 'base64').toString('utf8');
      expect(bodyDecoded).toContain('請求書');

      expect(google.auth.JWT).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test-sa@test-project.iam.gserviceaccount.com',
          scopes: ['https://www.googleapis.com/auth/gmail.send'],
          subject: 'noreply@example.com',
        })
      );
    });

    it('should skip email sending when NOTIFICATION_SA_KEY is not set', async () => {
      delete process.env.NOTIFICATION_SA_KEY;
      mockParsePubSubEvent.mockReturnValue({ data: successData });

      const event = buildEvent(successData, {
        operation: 'success-notification',
        fileId: 'file-123',
      });
      await notificationDispatcher(event);

      expect(mockPermissionsList).not.toHaveBeenCalled();
      expect(mockGmailSend).not.toHaveBeenCalled();
    });

    it('should log warning and not send email when no viewers found', async () => {
      mockParsePubSubEvent.mockReturnValue({ data: successData });

      mockPermissionsList.mockResolvedValue({
        data: {
          permissions: [{ type: 'anyone', role: 'reader' }],
        },
      });

      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const event = buildEvent(successData, {
        operation: 'success-notification',
        fileId: 'file-123',
      });
      await notificationDispatcher(event);

      expect(mockGmailSend).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No email addresses found')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('failure notification', () => {
    it('should look up parents from fileId and send to owner', async () => {
      const failureData = {
        fileId: 'file-456',
        fileName: 'broken.pdf',
        stageName: 'doc-processor',
        errorMessage: 'Invalid file data',
      };

      mockParsePubSubEvent.mockReturnValue({ data: failureData });

      mockFilesGet.mockResolvedValue({
        data: { parents: ['parent-folder-id'] },
      });

      mockPermissionsList.mockResolvedValue({
        data: {
          permissions: [
            { emailAddress: 'owner@example.com', role: 'owner', type: 'user' },
          ],
        },
      });

      const event = buildEvent(failureData, {
        operation: 'failure-notification',
        fileId: 'file-456',
      });
      await notificationDispatcher(event);

      expect(mockFilesGet).toHaveBeenCalledWith({
        fileId: 'file-456',
        fields: 'parents',
        supportsAllDrives: true,
      });

      expect(mockPermissionsList).toHaveBeenCalledWith({
        fileId: 'parent-folder-id',
        fields: 'permissions(emailAddress,role,type)',
        supportsAllDrives: true,
      });

      expect(mockGmailSend).toHaveBeenCalledTimes(1);
      expect(mockGmailSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({ raw: expect.any(String) }),
        })
      );

      const raw = mockGmailSend.mock.calls[0][0].requestBody.raw as string;
      const decoded = decodeRawEmail(raw);
      expect(decoded).toContain('To: owner@example.com');

      const subjectLine =
        decoded.split('\r\n').find((l) => l.startsWith('Subject:')) || '';
      const subjectB64 =
        subjectLine.match(/=\?UTF-8\?B\?([^?]+)\?=/)?.[1] || '';
      const subject = Buffer.from(subjectB64, 'base64').toString('utf8');
      expect(subject).toContain('ドキュメント処理失敗');

      const bodyB64 = decoded.split('\r\n\r\n')[1];
      const body = Buffer.from(bodyB64, 'base64').toString('utf8');
      expect(body).toContain('doc-processor');
    });

    it('should use folderId directly when no fileId is provided', async () => {
      const failureData = {
        folderId: 'scan-folder-id',
        stageName: 'drive-scanner',
        errorMessage: 'Folder not found',
      };

      mockParsePubSubEvent.mockReturnValue({ data: failureData });

      mockPermissionsList.mockResolvedValue({
        data: {
          permissions: [
            { emailAddress: 'owner@example.com', role: 'owner', type: 'user' },
          ],
        },
      });

      const event = buildEvent(failureData, {
        operation: 'failure-notification',
      });
      await notificationDispatcher(event);

      expect(mockFilesGet).not.toHaveBeenCalled();

      expect(mockPermissionsList).toHaveBeenCalledWith({
        fileId: 'scan-folder-id',
        fields: 'permissions(emailAddress,role,type)',
        supportsAllDrives: true,
      });

      expect(mockGmailSend).toHaveBeenCalledTimes(1);
    });

    it('should log warning when no owner found', async () => {
      const failureData = {
        fileId: 'file-789',
        stageName: 'text-vision-processor',
        errorMessage: 'Vision API error',
      };

      mockParsePubSubEvent.mockReturnValue({ data: failureData });

      mockFilesGet.mockResolvedValue({
        data: { parents: ['folder-id'] },
      });

      mockPermissionsList.mockResolvedValue({
        data: {
          permissions: [
            {
              emailAddress: 'reader@example.com',
              role: 'reader',
              type: 'user',
            },
          ],
        },
      });

      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const event = buildEvent(failureData, {
        operation: 'failure-notification',
        fileId: 'file-789',
      });
      await notificationDispatcher(event);

      expect(mockGmailSend).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No owner found')
      );

      consoleSpy.mockRestore();
    });

    it('should skip email sending when NOTIFICATION_SA_KEY is not set', async () => {
      delete process.env.NOTIFICATION_SA_KEY;
      const failureData = {
        fileId: 'file-456',
        stageName: 'doc-processor',
        errorMessage: 'Some error',
      };
      mockParsePubSubEvent.mockReturnValue({ data: failureData });

      const event = buildEvent(failureData, {
        operation: 'failure-notification',
      });
      await notificationDispatcher(event);

      expect(mockFilesGet).not.toHaveBeenCalled();
      expect(mockGmailSend).not.toHaveBeenCalled();
    });

    it('should warn when no fileId or folderId is provided', async () => {
      const failureData = {
        stageName: 'text-firebase-writer',
        errorMessage: 'Firestore error',
      };
      mockParsePubSubEvent.mockReturnValue({ data: failureData });

      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const event = buildEvent(failureData, {
        operation: 'failure-notification',
      });
      await notificationDispatcher(event);

      expect(mockGmailSend).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No fileId or folderId available')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('unknown operation', () => {
    it('should log warning for unknown operation and return', async () => {
      const data = { someField: 'value' };
      mockParsePubSubEvent.mockReturnValue({ data });

      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const event = buildEvent(data, { operation: 'unknown-operation' });
      await notificationDispatcher(event);

      expect(mockGmailSend).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Unknown notification operation: unknown-operation'
        )
      );

      consoleSpy.mockRestore();
    });
  });
});
