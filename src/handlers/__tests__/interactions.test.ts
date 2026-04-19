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
    notion = new NotionService('key', 'db1', 'db2') as jest.Mocked<NotionService>;
    slack = new SlackService(null as any, 'ch', 'ug') as jest.Mocked<SlackService>;
    userMapping = new UserMappingService(null as any) as jest.Mocked<UserMappingService>;

    // Default mock implementations
    notion.swapShiftPersons.mockResolvedValue(undefined);
    notion.createConstraint.mockResolvedValue(undefined);
    notion.getOverlappingShifts.mockResolvedValue([]);
    userMapping.getSlackMention.mockResolvedValue('<@U_REQ>');
    userMapping.getSlackUserId.mockResolvedValue('U_SOMEONE');
    slack.postToChannel.mockResolvedValue(undefined);
    slack.sendDM.mockResolvedValue(undefined);

    handler = new InteractionHandler(notion, slack, userMapping);
  });

  describe('switch_accept', () => {
    it('swaps shifts and posts confirmation to channel', async () => {
      const value = {
        shiftAId: 'shift-a',
        personAId: 'person-a',
        shiftBId: 'shift-b',
        personBId: 'person-b',
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
        'shift-a', 'person-a', 'shift-b', 'person-b',
      );
      expect(slack.postToChannel).toHaveBeenCalledWith(
        expect.stringContaining('<@U_VOL>'),
      );
      expect(slack.postToChannel).toHaveBeenCalledWith(
        expect.stringContaining('Swap complete'),
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
        email: 'alice@example.com',
        name: 'Alice',
        notionId: 'notion-alice',
      },
      view: {
        callback_id: 'add_constraint',
        state: {
          values: {
            start_date: { start_date_pick: { selected_date: '2026-06-01' } },
            end_date: { end_date_pick: { selected_date: '2026-06-07' } },
            reason: { reason_input: { value: 'Vacation' } },
          },
        },
      },
      ...overrides,
    });

    it('creates constraint in Notion and DMs confirmation', async () => {
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

      expect(notion.getOverlappingShifts).toHaveBeenCalledWith(
        'alice@example.com',
        '2026-06-01',
        '2026-06-07',
      );

      // First DM is the warning about overlapping shifts
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_USER',
        expect.stringContaining('Warning'),
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_USER',
        expect.stringContaining('2026-06-03'),
      );

      // Constraint should still be created
      expect(notion.createConstraint).toHaveBeenCalled();
    });
  });
});
