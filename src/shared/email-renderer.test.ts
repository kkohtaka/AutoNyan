import {
  renderSuccessEmail,
  renderFailureEmail,
  SuccessEmailData,
} from './email-renderer';

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
