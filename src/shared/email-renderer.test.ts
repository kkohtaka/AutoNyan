import {
  renderSuccessEmail,
  renderFailureEmail,
  renderCalendarEmail,
  CalendarEmailData,
  SuccessEmailData,
} from './email-renderer';

const originalPrefix = process.env.EMAIL_SUBJECT_PREFIX;

afterEach(() => {
  if (originalPrefix === undefined) {
    delete process.env.EMAIL_SUBJECT_PREFIX;
  } else {
    process.env.EMAIL_SUBJECT_PREFIX = originalPrefix;
  }
});

describe('renderSuccessEmail', () => {
  const data: SuccessEmailData = {
    firestoreDocId: 'doc-abc123',
    fileId: 'file-123',
    fileName: 'invoice.pdf',
    category: '請求書',
    confidence: 0.95,
    reasoning: 'Contains invoice keywords',
    summary: 'line1\nline2',
    destinationFolderId: 'dest-folder-id',
  };

  it('includes the category in the subject', () => {
    expect(renderSuccessEmail(data).subject).toBe(
      '[AutoNyan][請求書] 処理完了: invoice.pdf'
    );
  });

  it('uses the configured prefix when EMAIL_SUBJECT_PREFIX is set', () => {
    process.env.EMAIL_SUBJECT_PREFIX = '[AutoNyan E2E]';
    expect(renderSuccessEmail(data).subject).toBe(
      '[AutoNyan E2E][請求書] 処理完了: invoice.pdf'
    );
  });

  it('keeps the default prefix when EMAIL_SUBJECT_PREFIX is unset or empty', () => {
    delete process.env.EMAIL_SUBJECT_PREFIX;
    expect(renderSuccessEmail(data).subject).toBe(
      '[AutoNyan][請求書] 処理完了: invoice.pdf'
    );
    process.env.EMAIL_SUBJECT_PREFIX = '';
    expect(renderSuccessEmail(data).subject).toBe(
      '[AutoNyan][請求書] 処理完了: invoice.pdf'
    );
  });

  it('falls back to 未分類 when category is null', () => {
    const email = renderSuccessEmail({ ...data, category: null });
    expect(email.subject).toContain('[未分類]');
    expect(email.text).toContain('カテゴリ: 未分類');
  });

  it('links to the file and destination folder in both parts', () => {
    const email = renderSuccessEmail(data);
    expect(email.text).toContain(
      'https://drive.google.com/file/d/file-123/view'
    );
    expect(email.text).toContain(
      'https://drive.google.com/drive/folders/dest-folder-id'
    );
    expect(email.html).toContain(
      'href="https://drive.google.com/file/d/file-123/view"'
    );
    expect(email.html).toContain(
      'href="https://drive.google.com/drive/folders/dest-folder-id"'
    );
  });

  it('renders the confidence as a badge without a warning when high', () => {
    const email = renderSuccessEmail(data);
    expect(email.html).toContain('95%');
    expect(email.html).not.toContain('要確認');
    expect(email.text).not.toContain('要確認');
  });

  it('flags low-confidence results in both parts', () => {
    const email = renderSuccessEmail({ ...data, confidence: 0.4 });
    expect(email.html).toContain('40%（要確認）');
    expect(email.text).toContain('40%（要確認）');
  });

  it('announces a re-classification in the subject and both body parts', () => {
    const email = renderSuccessEmail({
      ...data,
      reclassified: true,
      originalFileName: 'unknown.pdf',
    });
    expect(email.subject).toBe('[AutoNyan][請求書] 再分類完了: invoice.pdf');
    expect(email.text).toContain('再分類しました');
    expect(email.html).toContain('再分類しました');
  });

  it('names the previous file name when a re-classification renamed the file', () => {
    const email = renderSuccessEmail({
      ...data,
      reclassified: true,
      originalFileName: 'unknown.pdf',
    });
    expect(email.text).toContain('元のファイル名: unknown.pdf');
    expect(email.html).toContain('unknown.pdf');
  });

  it('escapes HTML in dynamic values', () => {
    const email = renderSuccessEmail({ ...data, fileName: '<b>x</b>.pdf' });
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;.pdf');
  });

  it('converts summary newlines to <br> in the HTML part', () => {
    expect(renderSuccessEmail(data).html).toContain('line1<br>line2');
  });

  it('keeps the full details in the plain-text part', () => {
    const email = renderSuccessEmail(data);
    expect(email.text).toContain(
      'ファイル「invoice.pdf」の処理が完了しました。'
    );
    expect(email.text).toContain('分類理由: Contains invoice keywords');
    expect(email.text).toContain('Firestore ドキュメント ID: doc-abc123');
  });

  it('includes the shared header and auto-sent footer', () => {
    const email = renderSuccessEmail(data);
    expect(email.html).toContain('AutoNyan');
    expect(email.html).toContain('自動送信');
  });

  it('shows the final name and the original name when the file was renamed', () => {
    const email = renderSuccessEmail({
      ...data,
      fileName: '2026-08-01_請求書.pdf',
      originalFileName: 'scan_0012.pdf',
    });
    expect(email.subject).toBe(
      '[AutoNyan][請求書] 処理完了: 2026-08-01_請求書.pdf'
    );
    expect(email.text).toContain(
      'ファイル「2026-08-01_請求書.pdf」の処理が完了しました。'
    );
    expect(email.text).toContain('元のファイル名: scan_0012.pdf');
    expect(email.html).toContain('2026-08-01_請求書.pdf');
    expect(email.html).toContain('元のファイル名');
    expect(email.html).toContain('scan_0012.pdf');
  });

  it('shows a single file name and no rename hint when the name was kept', () => {
    const email = renderSuccessEmail(data);
    expect(email.text).not.toContain('元のファイル名');
    expect(email.html).not.toContain('元のファイル名');
  });
});

describe('renderFailureEmail', () => {
  const data = {
    stageName: 'doc-processor',
    errorMessage: 'Invalid file data',
  };

  it('renders the stage and error message in both parts', () => {
    const email = renderFailureEmail(data);
    expect(email.subject).toContain('ドキュメント処理失敗');
    expect(email.text).toContain('処理ステージ: doc-processor');
    expect(email.text).toContain('エラー内容: Invalid file data');
    expect(email.html).toContain('doc-processor');
    expect(email.html).toContain('Invalid file data');
  });

  it('uses the configured prefix when EMAIL_SUBJECT_PREFIX is set', () => {
    process.env.EMAIL_SUBJECT_PREFIX = '[AutoNyan E2E]';
    expect(renderFailureEmail(data).subject).toBe(
      '[AutoNyan E2E] ドキュメント処理失敗: '
    );
  });

  it('keeps the default prefix when EMAIL_SUBJECT_PREFIX is unset or empty', () => {
    delete process.env.EMAIL_SUBJECT_PREFIX;
    expect(renderFailureEmail(data).subject).toBe(
      '[AutoNyan] ドキュメント処理失敗: '
    );
    process.env.EMAIL_SUBJECT_PREFIX = '';
    expect(renderFailureEmail(data).subject).toBe(
      '[AutoNyan] ドキュメント処理失敗: '
    );
  });

  it('links to the file when fileId is present', () => {
    const email = renderFailureEmail({ ...data, fileId: 'file-456' });
    expect(email.text).toContain(
      'https://drive.google.com/file/d/file-456/view'
    );
    expect(email.html).toContain(
      'href="https://drive.google.com/file/d/file-456/view"'
    );
  });

  it('links to the folder when only folderId is present', () => {
    const email = renderFailureEmail({ ...data, folderId: 'folder-789' });
    expect(email.text).toContain(
      'https://drive.google.com/drive/folders/folder-789'
    );
    expect(email.html).toContain(
      'href="https://drive.google.com/drive/folders/folder-789"'
    );
  });

  it('omits link buttons when neither fileId nor folderId is present', () => {
    expect(renderFailureEmail(data).html).not.toContain('<a href');
  });

  it('uses the fileName in the subject when present', () => {
    const email = renderFailureEmail({ ...data, fileName: 'broken.pdf' });
    expect(email.subject).toContain('broken.pdf');
    expect(email.text).toContain('ファイル名: broken.pdf');
  });

  it('escapes HTML in the error message', () => {
    const email = renderFailureEmail({
      ...data,
      errorMessage: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('includes the shared header and auto-sent footer', () => {
    const email = renderFailureEmail(data);
    expect(email.html).toContain('AutoNyan');
    expect(email.html).toContain('自動送信');
  });
});

describe('renderCalendarEmail', () => {
  const data: CalendarEmailData = {
    firestoreDocId: 'doc-abc123',
    fileId: 'file-123',
    fileName: '5月号学級通信.pdf',
    calendarLabel: '学校',
    registeredEvents: [
      { title: '遠足', date: '2026-05-16', confidence: 0.9 },
      {
        title: '保護者会',
        date: '2026-05-20',
        startTime: '14:00',
        endTime: '15:30',
        location: '体育館',
        confidence: 0.95,
      },
    ],
    droppedEvents: [],
    truncated: false,
  };

  it('should report the registered event count in the subject', () => {
    const email = renderCalendarEmail(data);
    expect(email.subject).toContain('[学校]');
    expect(email.subject).toContain('2件');
    expect(email.subject).toContain('5月号学級通信.pdf');
  });

  it('should list every registered event in one mail', () => {
    const email = renderCalendarEmail(data);
    expect(email.text).toContain('2026-05-16（終日） 遠足');
    expect(email.text).toContain('2026-05-20 14:00〜15:30 保護者会（体育館）');
    expect(email.html).toContain('遠足');
    expect(email.html).toContain('保護者会');
  });

  it('should list events dropped for low confidence separately', () => {
    const email = renderCalendarEmail({
      ...data,
      droppedEvents: [
        { title: '未確定の行事', date: '2026-05-25', confidence: 0.4 },
      ],
    });
    expect(email.text).toContain('未確定の行事');
    expect(email.text).toContain('40%');
    expect(email.html).toContain('未確定の行事');
  });

  it('should omit the dropped section when nothing was dropped', () => {
    const email = renderCalendarEmail(data);
    expect(email.text).not.toContain('登録しなかった予定');
  });

  it('should warn when the source text was truncated', () => {
    const email = renderCalendarEmail({ ...data, truncated: true });
    expect(email.text).toContain('一部のみを解析');
    expect(email.html).toContain('一部のみを解析');
  });

  it('should escape HTML in event titles', () => {
    const email = renderCalendarEmail({
      ...data,
      registeredEvents: [
        {
          title: '<script>alert(1)</script>',
          date: '2026-05-16',
          confidence: 0.9,
        },
      ],
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('should apply the configured subject prefix', () => {
    process.env.EMAIL_SUBJECT_PREFIX = '[AutoNyan E2E]';
    expect(renderCalendarEmail(data).subject).toContain('[AutoNyan E2E]');
  });
});
