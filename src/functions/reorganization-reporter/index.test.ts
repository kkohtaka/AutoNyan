import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { MessagePublishedData } from '@google/events/cloud/pubsub/v1/MessagePublishedData';
import { PubSub } from '@google-cloud/pubsub';
import { ReorganizationRecord } from 'autonyan-shared';
import { reorganizationReporter } from './index';

jest.mock('@google-cloud/firestore');
const mockFirestore = Firestore as jest.MockedClass<typeof Firestore>;

jest.mock('@google-cloud/pubsub');
const mockPubSub = PubSub as jest.MockedClass<typeof PubSub>;

describe('reorganizationReporter', () => {
  let mockPublishMessage: jest.Mock;
  let mockTopic: jest.Mock;
  let mockWhere: jest.Mock;
  let mockSelect: jest.Mock;
  let mockGet: jest.Mock;
  let mockBatchUpdate: jest.Mock;
  let mockBatchCommit: jest.Mock;
  let callOrder: string[];

  const cloudEvent: CloudEvent<MessagePublishedData> = {
    specversion: '1.0',
    id: 'test-event-id',
    source: 'test-source',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    time: new Date().toISOString(),
    data: {
      data: Buffer.from(JSON.stringify({})).toString('base64'),
      message_id: 'test-message-id',
      publish_time: new Date().toISOString(),
    } as unknown as MessagePublishedData,
  };

  const minutesAgo = (minutes: number): string =>
    new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const record = (
    overrides: Partial<ReorganizationRecord> = {}
  ): ReorganizationRecord => ({
    batchId: 'batch-1',
    folderId: 'folder-invoices',
    folderPath: ['請求書'],
    requestedAt: minutesAgo(5),
    status: 'changed',
    reported: false,
    previousFileName: 'old.pdf',
    newFileName: 'new.pdf',
    ...overrides,
  });

  const givenRecords = (records: ReorganizationRecord[]): void => {
    mockGet.mockResolvedValue({
      docs: records.map((reorganization, index) => ({
        id: `doc-${index}`,
        data: () => ({ fileId: `file-${index}`, reorganization }),
        ref: { path: `extracted_texts/doc-${index}` },
      })),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];

    mockPublishMessage = jest.fn().mockImplementation(() => {
      callOrder.push('publish');
      return Promise.resolve('message-id');
    });
    mockTopic = jest
      .fn()
      .mockReturnValue({ publishMessage: mockPublishMessage });
    mockPubSub.mockImplementation(() => ({ topic: mockTopic }) as never);

    mockGet = jest.fn();
    mockSelect = jest.fn().mockReturnValue({ get: mockGet });
    mockWhere = jest.fn().mockReturnValue({ select: mockSelect });
    mockBatchUpdate = jest.fn();
    mockBatchCommit = jest.fn().mockImplementation(() => {
      callOrder.push('commit');
      return Promise.resolve();
    });
    mockFirestore.mockImplementation(
      () =>
        ({
          collection: jest.fn().mockReturnValue({ where: mockWhere }),
          batch: jest.fn().mockReturnValue({
            update: mockBatchUpdate,
            commit: mockBatchCommit,
          }),
        }) as never
    );

    process.env.NOTIFICATION_TOPIC = 'notification-topic';
  });

  afterEach(() => {
    delete process.env.NOTIFICATION_TOPIC;
  });

  it('should query only the requests that have not been reported', async () => {
    givenRecords([]);

    await reorganizationReporter(cloudEvent);

    expect(mockWhere).toHaveBeenCalledWith(
      'reorganization.reported',
      '==',
      false
    );
  });

  it('should publish one summary for a folder however many files changed in it', async () => {
    givenRecords([
      record(),
      record({
        previousFileName: 'kept.pdf',
        newFileName: undefined,
        newFolderId: 'folder-acme',
        newFolderPath: ['請求書', '取引先A'],
      }),
    ]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockTopic).toHaveBeenCalledWith('notification-topic');
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    expect(mockPublishMessage).toHaveBeenCalledWith({
      json: {
        folderId: 'folder-invoices',
        folderPath: ['請求書'],
        items: [
          {
            fileId: 'file-0',
            previousFileName: 'old.pdf',
            fileName: 'new.pdf',
          },
          {
            fileId: 'file-1',
            previousFileName: 'kept.pdf',
            fileName: 'kept.pdf',
            movedToPath: ['請求書', '取引先A'],
          },
        ],
        failedCount: 0,
      },
      attributes: {
        operation: 'reorganization-notification',
        folderId: 'folder-invoices',
      },
    });
    expect(result).toMatchObject({ groups: 1, notified: 1, waiting: 0 });
  });

  it('should publish a separate summary per folder and per batch', async () => {
    givenRecords([
      record(),
      record({ folderId: 'folder-contracts', folderPath: ['契約書'] }),
      record({ batchId: 'batch-2' }),
    ]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ groups: 3, notified: 3 });
  });

  it('should mark every request of a reported batch, after publishing, in one write', async () => {
    givenRecords([record(), record({ status: 'unchanged' })]);

    await reorganizationReporter(cloudEvent);

    expect(callOrder).toEqual(['publish', 'commit']);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'extracted_texts/doc-1' },
      { 'reorganization.reported': true }
    );
  });

  it('should send nothing for a batch in which nothing changed, and still mark it', async () => {
    givenRecords([
      record({ status: 'unchanged', newFileName: undefined }),
      record({ status: 'failed', newFileName: undefined }),
    ]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ groups: 1, notified: 0 });
  });

  it('should count the files that could not be changed alongside the ones that were', async () => {
    givenRecords([record(), record({ status: 'failed' })]);

    await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          items: [expect.objectContaining({ fileId: 'file-0' })],
          failedCount: 1,
        }),
      })
    );
  });

  it('should wait for a batch that still has outcomes outstanding', async () => {
    givenRecords([record(), record({ status: 'pending' })]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ groups: 1, notified: 0, waiting: 1 });
  });

  it('should report a batch without its stragglers once it has waited long enough', async () => {
    givenRecords([
      record({ requestedAt: minutesAgo(45) }),
      record({ requestedAt: minutesAgo(45), status: 'pending' }),
    ]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          items: [expect.objectContaining({ fileId: 'file-0' })],
        }),
      })
    );
    // The straggler is marked too, so the batch is never reported twice.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ notified: 1, waiting: 0 });
  });

  it('should do nothing when there is nothing to report', async () => {
    givenRecords([]);

    const result = await reorganizationReporter(cloudEvent);

    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ groups: 0, notified: 0, waiting: 0 });
  });

  it('should throw when the notification topic is not configured', async () => {
    delete process.env.NOTIFICATION_TOPIC;

    await expect(reorganizationReporter(cloudEvent)).rejects.toThrow(
      'Re-organization report failed'
    );
  });

  it('should throw so the run is retried when publishing fails, leaving the batch unmarked', async () => {
    givenRecords([record()]);
    mockPublishMessage.mockRejectedValue(new Error('Pub/Sub unavailable'));

    await expect(reorganizationReporter(cloudEvent)).rejects.toThrow(
      'Re-organization report failed: Pub/Sub unavailable'
    );
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
