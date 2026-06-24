import { CloudEvent } from '@google-cloud/functions-framework';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { parsePubSubEvent, createErrorResponse } from 'autonyan-shared';
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

function buildRfc2822Email(
  from: string,
  to: string,
  subject: string,
  body: string
): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const encodedBody = Buffer.from(body).toString('base64');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody,
  ].join('\r\n');
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
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
  const rawEmail = buildRfc2822Email(fromEmail, to, subject, body);
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
    // eslint-disable-next-line no-console
    console.warn(
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
    // eslint-disable-next-line no-console
    console.warn(
      `No email addresses found for destination folder: ${data.destinationFolderId}`
    );
    return;
  }

  const subject = `[AutoNyan] ドキュメント処理完了: ${data.fileName}`;
  const body = `ファイル「${data.fileName}」の処理が完了しました。

カテゴリ: ${data.category || '未分類'}
分類信頼度: ${Math.round(data.confidence * 100)}%
分類理由: ${data.reasoning}

要約:
${data.summary}

Firestore ドキュメント ID: ${data.firestoreDocId}`;

  for (const toEmail of emailAddresses) {
    await sendEmail(toEmail, subject, body, fromEmail, saKey);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Sent success notification to ${emailAddresses.length} recipient(s) for file: ${data.fileName}`
  );
}

async function handleFailureNotification(
  data: FailureNotificationData
): Promise<void> {
  const saKeyJson = process.env.NOTIFICATION_SA_KEY;
  if (!saKeyJson) {
    // eslint-disable-next-line no-console
    console.warn(
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
    // eslint-disable-next-line no-console
    console.warn(
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
    // eslint-disable-next-line no-console
    console.warn(`No owner or organizer found for folder: ${lookupFolderId}`);
    return;
  }

  const subject = `[AutoNyan] ドキュメント処理失敗: ${data.fileName || data.fileId || data.folderId || ''}`;
  const body = `ドキュメント処理中にエラーが発生しました。

処理ステージ: ${data.stageName}
エラー内容: ${data.errorMessage}
ファイル ID: ${data.fileId || ''}
フォルダ ID: ${data.folderId || ''}`;

  for (const toEmail of ownerEmails) {
    await sendEmail(toEmail, subject, body, fromEmail, saKey);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Sent failure notification to ${ownerEmails.length} owner(s) for stage: ${data.stageName}`
  );
}

export const notificationDispatcher = async (
  cloudEvent: CloudEvent<MessagePublishedData>
): Promise<void> => {
  try {
    // eslint-disable-next-line no-console
    console.log('Received PubSub event:', JSON.stringify(cloudEvent, null, 2));

    const { data: messageData } =
      parsePubSubEvent<NotificationMessage>(cloudEvent);

    // PubSub message attributes are delivered at the top level of the
    // CloudEvent (cloudEvent.attributes); cloudEvent.data carries only the
    // base64-encoded message body.
    const attributes =
      (cloudEvent as unknown as { attributes?: Record<string, string> })
        .attributes ?? {};
    const operation = attributes['operation'];

    // eslint-disable-next-line no-console
    console.log(`Processing notification operation: ${operation}`);

    if (operation === 'success-notification') {
      await handleSuccessNotification(
        messageData as unknown as SuccessNotificationData
      );
    } else if (operation === 'failure-notification') {
      await handleFailureNotification(
        messageData as unknown as FailureNotificationData
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Unknown notification operation: ${operation}`);
    }
  } catch (error) {
    const errorResponse = createErrorResponse(error, 'notificationDispatcher');
    // eslint-disable-next-line no-console
    console.error('Notification dispatcher error:', errorResponse);
    throw new Error(`Notification dispatcher failed: ${errorResponse.error}`);
  }
};
