import { WebClient } from '@slack/web-api';

export class UserMappingService {
  private slackClient: WebClient;
  private cache: Map<string, string | null> = new Map();

  constructor(slackClient: WebClient) {
    this.slackClient = slackClient;
  }

  async getSlackUserId(email: string): Promise<string | null> {
    if (this.cache.has(email)) return this.cache.get(email)!;
    try {
      const result = await this.slackClient.users.lookupByEmail({ email });
      const userId = result.user?.id || null;
      this.cache.set(email, userId);
      return userId;
    } catch {
      this.cache.set(email, null);
      return null;
    }
  }

  async getSlackMention(email: string): Promise<string> {
    const userId = await this.getSlackUserId(email);
    return userId ? `<@${userId}>` : email;
  }
}
