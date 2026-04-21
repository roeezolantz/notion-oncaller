import { InteractionHandler } from '../interactions';
import { NotionService } from '../../services/notion';
import { SlackService } from '../../services/slack';
import { UserMappingService } from '../../services/userMapping';

// Mock all three services
jest.mock('../../services/notion');
jest.mock('../../services/slack');
jest.mock('../../services/userMapping');

describe('InteractionHandler', () => {
  let handler: InteractionHandler;
  let notion: jest.Mocked<NotionService>;
  let slack: jest.Mocked<SlackService>;
  let userMapping: jest.Mocked<UserMappingService>;

  beforeEach(() => {
    notion = new NotionService('key', 'db1', 'db2', 'db2-page') as jest.Mocked<NotionService>;
    slack = new SlackService(null as any, 'ch', 'ug') as jest.Mocked<SlackService>;
    userMapping = new UserMappingService(null as any) as jest.Mocked<UserMappingService>;

    // Default mock implementations
    notion.swapShiftPersons.mockResolvedValue(undefined);
    notion.createConstraint.mockResolvedValue(undefined);
    notion.getOverlappingShifts.mockResolvedValue([]);
    notion.getShiftsForPerson.mockResolvedValue([]);
    userMapping.getSlackMention.mockResolvedValue('<@U_REQ>');
    userMapping.getSlackUserId.mockResolvedValue('U_SOMEONE');
    slack.postToChannel.mockResolvedValue(undefined);
    slack.sendDM.mockResolvedValue(undefined);

    handler = new InteractionHandler(notion, slack, userMapping);
  });

  describe('switch_accept', () => {
    it('finds volunteer shift, swaps, and posts confirmation', async () => {
      userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('bob@example.com');
      notion.getShiftsForPerson.mockResolvedValue([
        { id: 'vol-shift', personNotionId: 'person-b', status: 'Scheduled' } as any,
      ]);

      const value = {
        shiftAId: 'shift-a',
        personAId: 'person-a',
        requesterEmail: 'alice@example.com',
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      };

      const payload = {
        user: { id: 'U_VOL' },
        actions: [
          {
            action_id: 'switch_accept',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(notion.swapShiftPersons).toHaveBeenCalledWith(
        'shift-a', 'person-a', 'vol-shift', 'person-b',
      );
      expect(slack.postToChannel).toHaveBeenCalledWith(
        expect.stringContaining('<@U_VOL>'),
      );
    });
  });

  describe('switch_approve', () => {
    it('swaps shifts and notifies both parties via DM', async () => {
      userMapping.getSlackUserId
        .mockResolvedValueOnce('U_REQ')   // requester
        .mockResolvedValueOnce('U_TGT');  // target

      const value = {
        shiftAId: 'shift-a',
        personAId: 'person-a',
        shiftBId: 'shift-b',
        personBId: 'person-b',
        requesterEmail: 'alice@example.com',
        targetEmail: 'bob@example.com',
      };

      const payload = {
        user: { id: 'U_TGT' },
        actions: [
          {
            action_id: 'switch_approve',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(notion.swapShiftPersons).toHaveBeenCalledWith(
        'shift-a', 'person-a', 'shift-b', 'person-b',
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_REQ',
        expect.stringContaining('approved'),
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_TGT',
        expect.stringContaining('approved'),
      );
    });
  });

  describe('switch_decline', () => {
    it('DMs requester with decline notice', async () => {
      userMapping.getSlackUserId.mockResolvedValue('U_REQ');

      const value = {
        requesterEmail: 'alice@example.com',
        targetName: 'Bob',
      };

      const payload = {
        user: { id: 'U_TGT' },
        actions: [
          {
            action_id: 'switch_decline',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_REQ',
        expect.stringContaining('declined'),
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_REQ',
        expect.stringContaining('Bob'),
      );
    });
  });

  describe('add_constraint', () => {
    const makePayload = (overrides?: any) => ({
      user: {
        id: 'U_USER',
        name: 'Alice',
      },
      view: {
        callback_id: 'add_constraint',
        state: {
          values: {
            start_date_block: { start_date: { selected_date: '2026-06-01' } },
            end_date_block: { end_date: { selected_date: '2026-06-07' } },
            reason_block: { reason: { value: 'Vacation' } },
          },
        },
      },
      ...overrides,
    });

    it('creates constraint in Notion and DMs confirmation', async () => {
      userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
      notion.getShiftsForPerson.mockResolvedValue([
        { personNotionId: 'notion-alice' } as any,
      ]);

      await handler.handleViewSubmission(makePayload());

      expect(notion.createConstraint).toHaveBeenCalledWith(
        'notion-alice',
        'Alice',
        '2026-06-01',
        '2026-06-07',
        'Vacation',
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_USER',
        expect.stringContaining('2026-06-01'),
      );
    });

    it('warns about overlapping shifts', async () => {
      userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
      notion.getShiftsForPerson.mockResolvedValue([
        { personNotionId: 'notion-alice' } as any,
      ]);
      notion.getOverlappingShifts.mockResolvedValue([
        {
          id: 'shift-x',
          name: 'Week 23',
          personNotionId: 'notion-alice',
          personEmail: 'alice@example.com',
          personName: 'Alice',
          startDate: '2026-06-03',
          endDate: '2026-06-05',
          shiftType: 'Regular',
          status: 'Scheduled',
        },
      ]);

      await handler.handleViewSubmission(makePayload());

      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_USER',
        expect.stringContaining('overlapping'),
      );

      // Constraint should still be created
      expect(notion.createConstraint).toHaveBeenCalled();
    });
  });
});
