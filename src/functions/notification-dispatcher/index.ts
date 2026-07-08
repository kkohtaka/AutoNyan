import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import {
  parsePubSubEvent,
  createErrorResponse,
  logger,
  renderSuccessEmail,
  renderFailureEmail,
  RenderedEmail,
} from 'autonyan-shared';
import { google } from 'googleapis';

interface SuccessNotificationData extends Record<string, unknown> {
  firestoreDocId: string;
  fileId: string;
  fileName: string;
  category: string | null;
  confidence: number;
  reasoning: string;
  summary: string;
  destinationFolderId: string;
}

interface FailureNotificationData extends Record<string, unknown> {
  fileId?: string;
  folderId?: string;
  fileName?: string;
  stageName: string;
  errorMessage: string;
}

interface NotificationMessage extends Record<string, unknown> {
  [key: string]: unknown;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

// Roles that receive success notifications. Includes Shared Drive roles
// (organizer, fileOrganizer) alongside the My Drive roles, since members of a
// Shared Drive never have the My Drive `owner`/`reader` roles.
const NOTIFY_VIEWER_ROLES = [
  'reader',
  'commenter',
  'writer',
  'fileOrganizer',
  'organizer',
  'owner',
];

// Roles treated as the responsible owner of a folder for failure
// notifications. Shared Drives have no `owner`; `organizer` is the equivalent.
const FOLDER_OWNER_ROLES = ['owner', 'organizer'];

// Pipeline service accounts are shared on the Drive folders as `user`-type
// collaborators (see scripts/share-drive-folders.ts) so the functions can
// read/write them. Their `*.gserviceaccount.com` addresses are not real
// mailboxes — the domain has no MX records — so sending notifications to them
// bounces with NXDOMAIN. They must never be treated as notification recipients.
function isServiceAccountEmail(email: string): boolean {
  return email.toLowerCase().endsWith('.gserviceaccount.com');
}

// A static boundary is safe here: both parts are single-line base64 bodies,
// and the base64 alphabet contains no '-', so a body line can never match a
// '--boundary' delimiter.
const MULTIPART_BOUNDARY = 'autonyan-multipart-boundary';

function buildRfc2822Email(
  from: string,
  to: string,
  email: RenderedEmail
): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(email.subject).toString('base64')}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${MULTIPART_BOUNDARY}"`,
    '',
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(email.text).toString('base64'),
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(email.html).toString('base64'),
    `--${MULTIPART_BOUNDARY}--`,
  ].join('\r\n');
}

async function sendEmail(
  to: string,
  email: RenderedEmail,
  fromEmail: string,
  saKey: ServiceAccountKey
): Promise<void> {
  // Use Domain-Wide Delegation to impersonate the Workspace user
  const auth = new google.auth.JWT({
    email: saKey.client_email,
    key: saKey.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: fromEmail,
  });

  const gmail = google.gmail({ version: 'v1', auth });
  const rawEmail = buildRfc2822Email(fromEmail, to, email);
  const encodedEmail = Buffer.from(rawEmail).toString('base64url');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedEmail },
  });
}

async function handleSuccessNotification(
  data: SuccessNotificationData
): Promise<void> {
  const saKeyJson = process.env.NOTIFICATION_SA_KEY;
  if (!saKeyJson) {
    logger.warn(
      'NOTIFICATION_SA_KEY is not set, skipping success notification email'
    );
    return;
  }

  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || '';
  const saKey = JSON.parse(saKeyJson) as ServiceAccountKey;

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const permissionsResponse = await drive.permissions.list({
    fileId: data.destinationFolderId,
    fields: 'permissions(emailAddress,role,type)',
    supportsAllDrives: true,
  });

  const permissions = permissionsResponse.data.permissions || [];
  const emailAddresses = permissions
    .filter(
      (p) =>
        p.type === 'user' &&
        p.role !== undefined &&
        p.role !== null &&
        NOTIFY_VIEWER_ROLES.includes(p.role) &&
        p.emailAddress &&
        !isServiceAccountEmail(p.emailAddress)
    )
    .map((p) => p.emailAddress as string);

  if (emailAddresses.length === 0) {
    logger.warn('No email addresses found for destination folder', {
      destinationFolderId: data.destinationFolderId,
    });
    return;
  }

  const email = renderSuccessEmail(data);

  for (const toEmail of emailAddresses) {
    await sendEmail(toEmail, email, fromEmail, saKey);
  }

  logger.info('Sent success notification', {
    recipientCount: emailAddresses.length,
    fileName: data.fileName,
  });
}

async function handleFailureNotification(
  data: FailureNotificationData
): Promise<void> {
  const saKeyJson = process.env.NOTIFICATION_SA_KEY;
  if (!saKeyJson) {
    logger.warn(
      'NOTIFICATION_SA_KEY is not set, skipping failure notification email'
    );
    return;
  }

  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || '';
  const saKey = JSON.parse(saKeyJson) as ServiceAccountKey;

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  let lookupFolderId: string | undefined;

  if (data.fileId) {
    const fileResponse = await drive.files.get({
      fileId: data.fileId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const parents = fileResponse.data.parents;
    if (parents && parents.length > 0) {
      lookupFolderId = parents[0];
    }
  } else if (data.folderId) {
    lookupFolderId = data.folderId;
  }

  if (!lookupFolderId) {
    logger.warn(
      'No fileId or folderId available, cannot determine owner for failure notification'
    );
    return;
  }

  const permissionsResponse = await drive.permissions.list({
    fileId: lookupFolderId,
    fields: 'permissions(emailAddress,role,type)',
    supportsAllDrives: true,
  });

  const permissions = permissionsResponse.data.permissions || [];
  const ownerEmails = permissions
    .filter(
      (p) =>
        p.type === 'user' &&
        p.role !== undefined &&
        p.role !== null &&
        FOLDER_OWNER_ROLES.includes(p.role) &&
        p.emailAddress &&
        !isServiceAccountEmail(p.emailAddress)
    )
    .map((p) => p.emailAddress as string);

  if (ownerEmails.length === 0) {
    logger.warn('No owner or organizer found for folder', {
      folderId: lookupFolderId,
    });
    return;
  }

  const email = renderFailureEmail(data);

  for (const toEmail of ownerEmails) {
    await sendEmail(toEmail, email, fromEmail, saKey);
  }

  logger.info('Sent failure notification', {
    ownerCount: ownerEmails.length,
    stageName: data.stageName,
  });
}

export const notificationDispatcher = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<void> => {
  try {
    logger.info('Received PubSub event', { cloudEvent });

    const { data: messageData } =
      parsePubSubEvent<NotificationMessage>(cloudEvent);

    // PubSub message attributes are delivered at the top level of the
    // CloudEvent (cloudEvent.attributes); cloudEvent.data carries only the
    // base64-encoded message body.
    const attributes =
      (cloudEvent as unknown as { attributes?: Record<string, string> })
        .attributes ?? {};
    const operation = attributes['operation'];

    logger.info('Processing notification operation', { operation });

    if (operation === 'success-notification') {
      await handleSuccessNotification(
        messageData as unknown as SuccessNotificationData
      );
    } else if (operation === 'failure-notification') {
      await handleFailureNotification(
        messageData as unknown as FailureNotificationData
      );
    } else {
      logger.warn('Unknown notification operation', { operation });
    }
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'notificationDispatcher');
    logger.error('Notification dispatcher error', { error: errorResponse });
    throw new Error(`Notification dispatcher failed: ${errorResponse.error}`, {
      cause: error,
    });
  }
};
