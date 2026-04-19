import { WebClient } from '@slack/web-api';
import { UserMappingService } from '../userMapping';

function createMockSlackClient(overrides: Partial<{ lookupByEmail: jest.Mock }> = {}) {
  const lookupByEmail = overrides.lookupByEmail ?? jest.fn();
  return {
    users: { lookupByEmail },
  } as unknown as WebClient & { users: { lookupByEmail: jest.Mock } };
}

describe('UserMappingService', () => {
  it('resolves a Slack user ID from an email', async () => {
    const client = createMockSlackClient({
      lookupByEmail: jest.fn().mockResolvedValue({ user: { id: 'U12345' } }),
    });
    const service = new UserMappingService(client);

    const userId = await service.getSlackUserId('alice@example.com');

    expect(userId).toBe('U12345');
    expect(client.users.lookupByEmail).toHaveBeenCalledWith({ email: 'alice@example.com' });
  });

  it('caches results so the API is only called once per email', async () => {
    const client = createMockSlackClient({
      lookupByEmail: jest.fn().mockResolvedValue({ user: { id: 'U12345' } }),
    });
    const service = new UserMappingService(client);

    await service.getSlackUserId('alice@example.com');
    await service.getSlackUserId('alice@example.com');

    expect(client.users.lookupByEmail).toHaveBeenCalledTimes(1);
  });

  it('returns null and caches when the API throws (unknown email)', async () => {
    const client = createMockSlackClient({
      lookupByEmail: jest.fn().mockRejectedValue(new Error('users_not_found')),
    });
    const service = new UserMappingService(client);

    const userId = await service.getSlackUserId('unknown@example.com');
    expect(userId).toBeNull();

    // second call should not hit the API again
    const userId2 = await service.getSlackUserId('unknown@example.com');
    expect(userId2).toBeNull();
    expect(client.users.lookupByEmail).toHaveBeenCalledTimes(1);
  });

  describe('getSlackMention', () => {
    it('returns a Slack mention when the user is found', async () => {
      const client = createMockSlackClient({
        lookupByEmail: jest.fn().mockResolvedValue({ user: { id: 'U99999' } }),
      });
      const service = new UserMappingService(client);

      const mention = await service.getSlackMention('bob@example.com');
      expect(mention).toBe('<@U99999>');
    });

    it('falls back to the raw email when the user is not found', async () => {
      const client = createMockSlackClient({
        lookupByEmail: jest.fn().mockRejectedValue(new Error('users_not_found')),
      });
      const service = new UserMappingService(client);

      const mention = await service.getSlackMention('nobody@example.com');
      expect(mention).toBe('nobody@example.com');
    });
  });
});
