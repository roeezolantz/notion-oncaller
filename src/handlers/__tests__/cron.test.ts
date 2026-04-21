import dayjs from 'dayjs';
import { CronHandler } from '../cron';
import { NotionService } from '../../services/notion';
import { SlackService } from '../../services/slack';
import { UserMappingService } from '../../services/userMapping';
import { Shift } from '../../types';

// Mock all services
jest.mock('../../services/notion');
jest.mock('../../services/slack');
jest.mock('../../services/userMapping');
jest.mock('../../config', () => ({
  config: {
    notion: { scheduleUrl: 'https://notion.so/test' },
  },
}));
jest.mock('../../utils', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    name: 'Test Shift',
    personNotionId: 'notion-1',
    personEmail: 'alice@example.com',
    personName: 'Alice',
    startDate: '2026-04-19',
    endDate: '2026-04-26',
    shiftType: 'Regular',
    status: 'Scheduled',
    ...overrides,
  };
}

describe('CronHandler', () => {
  let handler: CronHandler;
  let notion: jest.Mocked<NotionService>;
  let slack: jest.Mocked<SlackService>;
  let userMapping: jest.Mocked<UserMappingService>;

  beforeEach(() => {
    notion = new NotionService('' as any, '', '', '') as jest.Mocked<NotionService>;
    slack = new SlackService(null as any, '', '') as jest.Mocked<SlackService>;
    userMapping = new UserMappingService(null as any) as jest.Mocked<UserMappingService>;

    // Default: no shifts anywhere
    notion.getShiftsByDate.mockResolvedValue([]);
    notion.getActiveShift.mockResolvedValue(null);
    notion.updateShiftStatus.mockResolvedValue(undefined);
    slack.postToChannel.mockResolvedValue(undefined);
    slack.sendDM.mockResolvedValue(undefined);
    slack.updateOncallGroup.mockResolvedValue(undefined);
    userMapping.getSlackUserId.mockResolvedValue(null);
    userMapping.getSlackMention.mockResolvedValue('alice@example.com');

    handler = new CronHandler(notion, slack, userMapping);

    // Fix "today" for deterministic tests
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-19T08:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('shift change', () => {
    it('transitions old shift to Completed, new to Active, updates @oncall group, posts to channel', async () => {
      const oldShift = makeShift({ id: 'old-shift', status: 'Active', personEmail: 'bob@example.com' });
      const newShift = makeShift({ id: 'new-shift', personEmail: 'alice@example.com' });

      notion.getShiftsByDate.mockImplementation(async (date: string) => {
        if (date === '2026-04-19') return [newShift];
        return [];
      });
      notion.getActiveShift.mockResolvedValue(oldShift);
      userMapping.getSlackUserId.mockResolvedValue('U12345');
      userMapping.getSlackMention.mockResolvedValue('<@U12345>');

      await handler.handleDaily();

      // Old shift marked Completed
      expect(notion.updateShiftStatus).toHaveBeenCalledWith('old-shift', 'Completed');
      // New shift marked Active
      expect(notion.updateShiftStatus).toHaveBeenCalledWith('new-shift', 'Active');
      // Oncall group updated
      expect(slack.updateOncallGroup).toHaveBeenCalledWith('U12345');
      // Channel notified
      expect(slack.postToChannel).toHaveBeenCalledWith(
        expect.stringContaining('<@U12345> is now on-call'),
        expect.any(Array),
      );
    });

    it('does nothing when no shift starts today (besides sync)', async () => {
      notion.getShiftsByDate.mockResolvedValue([]);
      notion.getActiveShift.mockResolvedValue(null);

      await handler.handleDaily();

      // getActiveShift is called by syncOncallGroup, but no shift change happens
      expect(notion.updateShiftStatus).not.toHaveBeenCalled();
      expect(slack.postToChannel).not.toHaveBeenCalled();
    });
  });

  describe('reminders', () => {
    it('sends 1-day reminder DM', async () => {
      const tomorrowShift = makeShift({ startDate: '2026-04-20', endDate: '2026-04-27' });

      notion.getShiftsByDate.mockImplementation(async (date: string) => {
        if (date === '2026-04-20') return [tomorrowShift];
        return [];
      });
      userMapping.getSlackUserId.mockResolvedValue('U12345');

      await handler.handleDaily();

      expect(slack.sendDM).toHaveBeenCalledWith(
        'U12345',
        expect.stringContaining(':bell: *Reminder:* Your on-call shift starts in 1 day'),
        expect.any(Array),
      );
    });

    it('sends 7-day reminder DM', async () => {
      const futureShift = makeShift({ startDate: '2026-04-26', endDate: '2026-05-03' });

      notion.getShiftsByDate.mockImplementation(async (date: string) => {
        if (date === '2026-04-26') return [futureShift];
        return [];
      });
      userMapping.getSlackUserId.mockResolvedValue('U99999');

      await handler.handleDaily();

      expect(slack.sendDM).toHaveBeenCalledWith(
        'U99999',
        expect.stringContaining(':calendar_spiral: *Reminder:* Your on-call shift starts in 7 days'),
        expect.any(Array),
      );
    });

    it('skips reminder if user not found in Slack', async () => {
      const tomorrowShift = makeShift({ startDate: '2026-04-20' });

      notion.getShiftsByDate.mockImplementation(async (date: string) => {
        if (date === '2026-04-20') return [tomorrowShift];
        return [];
      });
      userMapping.getSlackUserId.mockResolvedValue(null);

      await handler.handleDaily();

      expect(slack.sendDM).not.toHaveBeenCalled();
    });
  });
});
