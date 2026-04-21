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
    notion.reassignShift.mockResolvedValue(undefined);
    notion.createConstraint.mockResolvedValue(undefined);
    notion.getOverlappingShifts.mockResolvedValue([]);
    notion.getShiftsForPerson.mockResolvedValue([]);
    userMapping.getSlackMention.mockResolvedValue('<@U_REQ>');
    userMapping.getSlackUserId.mockResolvedValue('U_SOMEONE');
    slack.postToChannel.mockResolvedValue(undefined);
    slack.sendDM.mockResolvedValue(undefined);
    slack.updateMessage.mockResolvedValue(undefined);

    handler = new InteractionHandler(notion, slack, userMapping);
  });

  describe('replacement_accept', () => {
    it('reassigns shift and updates message', async () => {
      userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('bob@example.com');
      notion.getShiftsForPerson.mockResolvedValue([
        { id: 'vol-shift', personNotionId: 'person-b', status: 'Scheduled' } as any,
      ]);

      const value = {
        shiftId: 'shift-a',
        personId: 'person-a',
        requesterEmail: 'alice@example.com',
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      };

      const payload = {
        user: { id: 'U_VOL' },
        channel: { id: 'C_ONCALL' },
        message: { ts: '123.456' },
        actions: [
          {
            action_id: 'replacement_accept',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(notion.reassignShift).toHaveBeenCalledWith('shift-a', 'person-b');
      expect(slack.updateMessage).toHaveBeenCalledWith(
        'C_ONCALL',
        '123.456',
        expect.stringContaining('<@U_VOL>'),
        [],
      );
    });
  });

  describe('replacement_cancel', () => {
    it('updates message with cancellation', async () => {
      const payload = {
        user: { id: 'U_REQ' },
        channel: { id: 'C_ONCALL' },
        message: { ts: '123.456' },
        actions: [
          {
            action_id: 'replacement_cancel',
            value: JSON.stringify({}),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(slack.updateMessage).toHaveBeenCalledWith(
        'C_ONCALL',
        '123.456',
        expect.stringContaining('cancelled'),
        [],
      );
    });
  });

  describe('swap_accept', () => {
    it('swaps shifts and notifies both parties', async () => {
      userMapping.getSlackUserId.mockResolvedValue('U_PROPOSER');
      userMapping.getSlackMention
        .mockResolvedValueOnce('<@U_PROPOSER>')  // proposerMention
        .mockResolvedValueOnce('<@U_REQ>');       // requesterMention

      const value = {
        requesterShiftId: 'shift-a',
        requesterPersonId: 'person-a',
        requesterEmail: 'alice@example.com',
        requesterStartDate: '2026-05-01',
        requesterEndDate: '2026-05-07',
        proposerShiftId: 'shift-b',
        proposerPersonId: 'person-b',
        proposerEmail: 'bob@example.com',
        proposerStartDate: '2026-05-08',
        proposerEndDate: '2026-05-14',
        channelId: 'C_ONCALL',
        messageTs: '111.222',
      };

      const payload = {
        user: { id: 'U_REQ' },
        channel: { id: 'DM_CHAN' },
        message: { ts: '999.888' },
        actions: [
          {
            action_id: 'swap_accept',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(notion.swapShiftPersons).toHaveBeenCalledWith(
        'shift-a', 'person-a', 'shift-b', 'person-b',
      );
      // DM update
      expect(slack.updateMessage).toHaveBeenCalledWith(
        'DM_CHAN',
        '999.888',
        expect.stringContaining('Swap complete'),
        [],
      );
      // Channel update
      expect(slack.updateMessage).toHaveBeenCalledWith(
        'C_ONCALL',
        '111.222',
        expect.stringContaining('Swapped'),
        [],
      );
      // DM the proposer
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_PROPOSER',
        expect.stringContaining('accepted'),
      );
    });
  });

  describe('swap_decline_proposal', () => {
    it('updates DM and notifies proposer', async () => {
      userMapping.getSlackUserId.mockResolvedValue('U_PROPOSER');

      const value = {
        proposerEmail: 'bob@example.com',
      };

      const payload = {
        user: { id: 'U_REQ' },
        channel: { id: 'DM_CHAN' },
        message: { ts: '999.888' },
        actions: [
          {
            action_id: 'swap_decline_proposal',
            value: JSON.stringify(value),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(slack.updateMessage).toHaveBeenCalledWith(
        'DM_CHAN',
        '999.888',
        expect.stringContaining('declined'),
        [],
      );
      expect(slack.sendDM).toHaveBeenCalledWith(
        'U_PROPOSER',
        expect.stringContaining('declined'),
      );
    });
  });

  describe('swap_cancel', () => {
    it('updates channel message with cancellation', async () => {
      const payload = {
        user: { id: 'U_REQ' },
        channel: { id: 'C_ONCALL' },
        message: { ts: '123.456' },
        actions: [
          {
            action_id: 'swap_cancel',
            value: JSON.stringify({}),
          },
        ],
      };

      await handler.handleBlockAction(payload);

      expect(slack.updateMessage).toHaveBeenCalledWith(
        'C_ONCALL',
        '123.456',
        expect.stringContaining('cancelled'),
        [],
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
