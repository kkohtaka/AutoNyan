// Shared renderer for notification emails. Success and failure notifications
// share the same layout (header, footer, buttons) so the HTML lives here
// instead of being duplicated per handler.

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface SuccessEmailData {
  firestoreDocId: string;
  fileId: string;
  // Name the file actually has after processing.
  fileName: string;
  // Set only when the file was renamed; its absence means the file kept its
  // original name.
  originalFileName?: string;
  category: string | null;
  confidence: number;
  reasoning: string;
  summary: string;
  destinationFolderId: string;
}

export interface CalendarEventSummary {
  title: string;
  // Resolved calendar date, as YYYY-MM-DD.
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  confidence: number;
}

export interface CalendarEmailData {
  firestoreDocId: string;
  fileId: string;
  fileName: string;
  calendarLabel: string;
  registeredEvents: CalendarEventSummary[];
  // Events extracted below the confidence threshold. Reported rather than
  // silently discarded, so a missed event is visible to the recipient.
  droppedEvents: CalendarEventSummary[];
  // The source text was longer than the extraction limit, so events may be
  // missing entirely.
  truncated: boolean;
}

export interface FailureEmailData {
  fileId?: string;
  folderId?: string;
  fileName?: string;
  stageName: string;
  errorMessage: string;
}

// Below this confidence the badge switches to a warning style so recipients
// know to double-check the classification.
const LOW_CONFIDENCE_THRESHOLD = 0.7;

// Non-production deployments send real mail through the same pipeline as
// production, so they set EMAIL_SUBJECT_PREFIX to a prefix a recipient can
// filter on. Read per call rather than at module load so a deployment's
// configuration is picked up wherever the renderer is used.
const DEFAULT_SUBJECT_PREFIX = '[AutoNyan]';

function subjectPrefix(): string {
  return process.env.EMAIL_SUBJECT_PREFIX || DEFAULT_SUBJECT_PREFIX;
}

const FONT_FAMILY =
  "'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',Meiryo,sans-serif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtmlLines(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function renderButton(label: string, url: string, primary: boolean): string {
  const style = primary
    ? 'background-color:#1a73e8;color:#ffffff;border:1px solid #1a73e8;'
    : 'background-color:#ffffff;color:#1a73e8;border:1px solid #dadce0;';
  return `<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;border-radius:4px;font-size:14px;text-decoration:none;${style}">${escapeHtml(label)}</a>`;
}

function renderButtonRow(buttons: string[]): string {
  const cells = buttons
    .map(
      (button, index) =>
        `<td style="padding:${index === 0 ? '0' : '0 0 0 12px'};">${button}</td>`
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>${cells}</tr></table>`;
}

function renderDetailRow(label: string, valueHtml: string): string {
  return (
    '<tr>' +
    `<td style="padding:6px 16px 6px 0;font-size:13px;color:#5f6368;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#202124;">${valueHtml}</td>` +
    '</tr>'
  );
}

function renderConfidenceBadge(confidence: number): string {
  const percent = Math.round(confidence * 100);
  const isLow = confidence < LOW_CONFIDENCE_THRESHOLD;
  const style = isLow
    ? 'background-color:#fce8e6;color:#c5221f;'
    : 'background-color:#e6f4ea;color:#137333;';
  const label = isLow ? `${percent}%（要確認）` : `${percent}%`;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;${style}">${label}</span>`;
}

// Table-based layout with inline styles only: Gmail and Outlook strip <style>
// blocks and ignore most modern CSS.
function renderLayout(contentHtml: string): string {
  return (
    '<!DOCTYPE html>' +
    '<html><body style="margin:0;padding:0;background-color:#f1f3f4;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f3f4;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #dadce0;border-radius:8px;">' +
    `<tr><td style="padding:20px 32px;border-bottom:1px solid #dadce0;font-family:${FONT_FAMILY};font-size:18px;font-weight:bold;color:#202124;">AutoNyan</td></tr>` +
    `<tr><td style="padding:28px 32px;font-family:${FONT_FAMILY};font-size:14px;color:#202124;line-height:1.7;">${contentHtml}</td></tr>` +
    `<tr><td style="padding:16px 32px;border-top:1px solid #dadce0;font-family:${FONT_FAMILY};font-size:12px;color:#80868b;">このメールは AutoNyan により自動送信されています。</td></tr>` +
    '</table></td></tr></table>' +
    '</body></html>'
  );
}

export function renderSuccessEmail(data: SuccessEmailData): RenderedEmail {
  const category = data.category || '未分類';
  const percent = Math.round(data.confidence * 100);
  const isLowConfidence = data.confidence < LOW_CONFIDENCE_THRESHOLD;
  const fileUrl = driveFileUrl(data.fileId);
  const folderUrl = driveFolderUrl(data.destinationFolderId);

  const subject = `${subjectPrefix()}[${category}] 処理完了: ${data.fileName}`;

  const renamedLine = data.originalFileName
    ? `元のファイル名: ${data.originalFileName}\n`
    : '';

  const text = `ファイル「${data.fileName}」の処理が完了しました。

${renamedLine}カテゴリ: ${category}
分類信頼度: ${percent}%${isLowConfidence ? '（要確認）' : ''}
分類理由: ${data.reasoning}

要約:
${data.summary}

ファイルを開く: ${fileUrl}
保存先フォルダを開く: ${folderUrl}

Firestore ドキュメント ID: ${data.firestoreDocId}`;

  const html = renderLayout(
    `<p style="margin:0 0 20px;">ファイル「<strong>${escapeHtml(data.fileName)}</strong>」の処理が完了しました。</p>` +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">' +
      (data.originalFileName
        ? renderDetailRow('元のファイル名', escapeHtml(data.originalFileName))
        : '') +
      renderDetailRow('カテゴリ', escapeHtml(category)) +
      renderDetailRow('分類信頼度', renderConfidenceBadge(data.confidence)) +
      renderDetailRow('分類理由', toHtmlLines(data.reasoning)) +
      renderDetailRow('要約', toHtmlLines(data.summary)) +
      renderDetailRow('ドキュメント ID', escapeHtml(data.firestoreDocId)) +
      '</table>' +
      renderButtonRow([
        renderButton('ファイルを開く', fileUrl, true),
        renderButton('保存先フォルダを開く', folderUrl, false),
      ])
  );

  return { subject, text, html };
}

export function renderFailureEmail(data: FailureEmailData): RenderedEmail {
  const subject = `${subjectPrefix()} ドキュメント処理失敗: ${data.fileName || data.fileId || data.folderId || ''}`;

  const textLines = [
    'ドキュメント処理中にエラーが発生しました。',
    '',
    `処理ステージ: ${data.stageName}`,
    `エラー内容: ${data.errorMessage}`,
  ];
  if (data.fileName) {
    textLines.push(`ファイル名: ${data.fileName}`);
  }
  if (data.fileId) {
    textLines.push(`対象ファイル: ${driveFileUrl(data.fileId)}`);
  }
  if (data.folderId) {
    textLines.push(`対象フォルダ: ${driveFolderUrl(data.folderId)}`);
  }

  const detailRows = [
    renderDetailRow('処理ステージ', escapeHtml(data.stageName)),
    renderDetailRow('エラー内容', toHtmlLines(data.errorMessage)),
  ];
  if (data.fileName) {
    detailRows.push(renderDetailRow('ファイル名', escapeHtml(data.fileName)));
  }

  const buttons: string[] = [];
  if (data.fileId) {
    buttons.push(
      renderButton('対象ファイルを開く', driveFileUrl(data.fileId), true)
    );
  }
  if (data.folderId) {
    buttons.push(
      renderButton(
        '対象フォルダを開く',
        driveFolderUrl(data.folderId),
        buttons.length === 0
      )
    );
  }

  const html = renderLayout(
    '<p style="margin:0 0 20px;color:#c5221f;font-weight:bold;">ドキュメント処理中にエラーが発生しました。</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">' +
      detailRows.join('') +
      '</table>' +
      (buttons.length > 0 ? renderButtonRow(buttons) : '')
  );

  return { subject, text: textLines.join('\n'), html };
}

function formatEventTime(event: CalendarEventSummary): string {
  if (!event.startTime) {
    return `${event.date}（終日）`;
  }
  const range = event.endTime
    ? `${event.startTime}〜${event.endTime}`
    : event.startTime;
  return `${event.date} ${range}`;
}

function formatEventLine(event: CalendarEventSummary): string {
  const location = event.location ? `（${event.location}）` : '';
  return `${formatEventTime(event)} ${event.title}${location}`;
}

function renderEventList(events: CalendarEventSummary[]): string {
  const items = events
    .map(
      (event) =>
        `<li style="margin:0 0 6px;">${escapeHtml(formatEventLine(event))}</li>`
    )
    .join('');
  return `<ul style="margin:0;padding-left:20px;">${items}</ul>`;
}

export function renderCalendarEmail(data: CalendarEmailData): RenderedEmail {
  const fileUrl = driveFileUrl(data.fileId);
  const registeredCount = data.registeredEvents.length;

  const subject = `${subjectPrefix()}[${data.calendarLabel}] ${registeredCount}件の予定を登録しました: ${data.fileName}`;

  const textLines = [
    `ファイル「${data.fileName}」から ${registeredCount} 件の予定を「${data.calendarLabel}」カレンダーに登録しました。`,
    '',
    '登録した予定:',
    ...data.registeredEvents.map((event) => `- ${formatEventLine(event)}`),
  ];

  if (data.droppedEvents.length > 0) {
    textLines.push(
      '',
      '確信度が低いため登録しなかった予定（内容をご確認ください）:',
      ...data.droppedEvents.map(
        (event) =>
          `- ${formatEventLine(event)} [確信度 ${Math.round(event.confidence * 100)}%]`
      )
    );
  }

  if (data.truncated) {
    textLines.push(
      '',
      '注意: 文書が長いため一部のみを解析しました。登録されていない予定がある可能性があります。'
    );
  }

  textLines.push('', `ファイルを開く: ${fileUrl}`);

  const html = renderLayout(
    `<p style="margin:0 0 20px;">ファイル「<strong>${escapeHtml(data.fileName)}</strong>」から <strong>${registeredCount}</strong> 件の予定を「${escapeHtml(data.calendarLabel)}」カレンダーに登録しました。</p>` +
      '<p style="margin:0 0 8px;font-weight:bold;">登録した予定</p>' +
      renderEventList(data.registeredEvents) +
      (data.droppedEvents.length > 0
        ? '<p style="margin:20px 0 8px;font-weight:bold;color:#c5221f;">確信度が低いため登録しなかった予定</p>' +
          renderEventList(data.droppedEvents)
        : '') +
      (data.truncated
        ? '<p style="margin:20px 0 0;color:#c5221f;">文書が長いため一部のみを解析しました。登録されていない予定がある可能性があります。</p>'
        : '') +
      renderButtonRow([renderButton('ファイルを開く', fileUrl, true)])
  );

  return { subject, text: textLines.join('\n'), html };
}
