import type { PubSub } from '@google-cloud/pubsub';
import { logger, publishFailureNotification, withEventContext } from './index';

describe('publishFailureNotification', () => {
  const originalTopic = process.env.NOTIFICATION_TOPIC;
  let publishMessage: jest.Mock;
  let pubsub: PubSub;

  beforeEach(() => {
    publishMessage = jest.fn().mockResolvedValue('message-id');
    pubsub = {
      topic: jest.fn().mockReturnValue({ publishMessage }),
    } as unknown as PubSub;
    process.env.NOTIFICATION_TOPIC = 'notification-trigger';
  });

  afterEach(() => {
    if (originalTopic === undefined) {
      delete process.env.NOTIFICATION_TOPIC;
    } else {
      process.env.NOTIFICATION_TOPIC = originalTopic;
    }
    jest.restoreAllMocks();
  });

  it('publishes nothing when NOTIFICATION_TOPIC is unset', async () => {
    delete process.env.NOTIFICATION_TOPIC;

    await publishFailureNotification(pubsub, {
      stageName: 'stage',
      errorMessage: 'failed',
    });

    expect(pubsub.topic).not.toHaveBeenCalled();
  });

  it('publishes the details and the current event ID to the configured topic', async () => {
    const run = withEventContext(async () =>
      publishFailureNotification(pubsub, {
        stageName: 'stage',
        errorMessage: 'failed',
        fileId: 'file-1',
        fileName: 'doc.pdf',
      })
    );

    await run(undefined, { eventId: 'event-123' });

    expect(pubsub.topic).toHaveBeenCalledWith('notification-trigger');
    expect(publishMessage).toHaveBeenCalledWith({
      json: {
        stageName: 'stage',
        errorMessage: 'failed',
        fileId: 'file-1',
        fileName: 'doc.pdf',
        eventId: 'event-123',
      },
      attributes: { operation: 'failure-notification', fileId: 'file-1' },
    });
  });

  it('omits the event ID and the fileId attribute when neither is known', async () => {
    await publishFailureNotification(pubsub, {
      stageName: 'stage',
      errorMessage: 'failed',
      folderId: 'folder-1',
    });

    expect(publishMessage).toHaveBeenCalledWith({
      json: {
        stageName: 'stage',
        errorMessage: 'failed',
        folderId: 'folder-1',
      },
      attributes: { operation: 'failure-notification' },
    });
  });

  it('warns instead of throwing when the publish fails', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    publishMessage.mockRejectedValueOnce(new Error('publish failed'));

    await expect(
      publishFailureNotification(pubsub, {
        stageName: 'stage',
        errorMessage: 'failed',
      })
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'Failed to publish failure notification',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});
