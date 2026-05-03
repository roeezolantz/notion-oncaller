import { InteractionHandler } from '../interactions';
import { NotionService } from '../../services/notion';
import { SlackService } from '../../services/slack';
import { UserMappingService } from '../../services/userMapping';
import { BroadcastService } from '../../services/broadcast';

// Mock all four services
jest.mock('../../services/notion');
jest.mock('../../services/slack');
jest.mock('../../services/userMapping');
jest.mock('../../services/broadcast');

describe('InteractionHandler', () => {
  let handler: InteractionHandler;
  let notion: jest.Mocked<NotionService>;
  let slack: jest.Mocked<SlackService>;
  let userMapping: jest.Mocked<UserMappingService>;
  let broadcast: jest.Mocked<BroadcastService>;

  beforeEach(() => {
    notion = new NotionService('key', 'db1', 'db2', 'db2-page') as jest.Mocked<NotionService>;
    slack = new SlackService(null as any, 'ch', 'ug') as jest.Mocked<SlackService>;
    userMapping = new UserMappingService(null as any) as jest.Mocked<UserMappingService>;
    broadcast = new BroadcastService(notion, userMapping) as jest.Mocked<BroadcastService>;

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
    slack.respondToInteraction.mockResolvedValue(undefined);
    broadcast.buildPlan.mockResolvedValue({ recipients: [], skipped: [] });

    handler = new InteractionHandler(notion, slack, userMapping, broadcast);
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
      expect(slack.updateMessage).toHaveBeenCalledWith('C_ONCALL', '123.456', expect.stringContaining('<@U_VOL>'), []);
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

      expect(slack.updateMessage).toHaveBeenCalledWith('C_ONCALL', '123.456', expect.stringContaining('cancelled'), []);
    });
  });

  describe('swap_accept', () => {
    it('swaps shifts and notifies both parties', async () => {
      userMapping.getSlackUserId.mockResolvedValue('U_PROPOSER');
      userMapping.getSlackMention
        .mockResolvedValueOnce('<@U_PROPOSER>') // proposerMention
        .mockResolvedValueOnce('<@U_REQ>'); // requesterMention

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

      expect(notion.swapShiftPersons).toHaveBeenCalledWith('shift-a', 'person-a', 'shift-b', 'person-b');
      // DM update
      expect(slack.updateMessage).toHaveBeenCalledWith(
        'DM_CHAN',
        '999.888',
        expect.stringContaining('Swap complete'),
        [],
      );
      // Channel update
      expect(slack.updateMessage).toHaveBeenCalledWith('C_ONCALL', '111.222', expect.stringContaining('Swapped'), []);
      // DM the proposer
      expect(slack.sendDM).toHaveBeenCalledWith('U_PROPOSER', expect.stringContaining('accepted'));
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

      expect(slack.updateMessage).toHaveBeenCalledWith('DM_CHAN', '999.888', expect.stringContaining('declined'), []);
      expect(slack.sendDM).toHaveBeenCalledWith('U_PROPOSER', expect.stringContaining('declined'));
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

      expect(slack.updateMessage).toHaveBeenCalledWith('C_ONCALL', '123.456', expect.stringContaining('cancelled'), []);
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
      notion.getShiftsForPerson.mockResolvedValue([{ personNotionId: 'notion-alice' } as any]);

      await handler.handleViewSubmission(makePayload());

      expect(notion.createConstraint).toHaveBeenCalledWith(
        'notion-alice',
        'Alice',
        '2026-06-01',
        '2026-06-07',
        'Vacation',
      );
      expect(slack.sendDM).toHaveBeenCalledWith('U_USER', expect.stringContaining('2026-06-01'));
    });

    it('warns about overlapping shifts', async () => {
      userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
      notion.getShiftsForPerson.mockResolvedValue([{ personNotionId: 'notion-alice' } as any]);
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

      expect(slack.sendDM).toHaveBeenCalledWith('U_USER', expect.stringContaining('overlapping'));

      // Constraint should still be created
      expect(notion.createConstraint).toHaveBeenCalled();
    });
  });

  describe('broadcast buttons', () => {
    function broadcastPayload(actionId: string): any {
      return {
        user: { id: 'U_ADMIN' },
        response_url: 'https://hooks.slack.com/actions/abc',
        trigger_id: 'trigger-abc',
        actions: [
          {
            action_id: actionId,
            value: JSON.stringify({ kind: actionId }),
          },
        ],
      };
    }

    describe('broadcast_send', () => {
      it('denies non-admins via response_url and never builds the plan or sends DMs', async () => {
        const ORIGINAL = process.env.ONCALL_ADMINS;
        process.env.ONCALL_ADMINS = 'someone-else@example.com';
        jest.resetModules();
        const { InteractionHandler: FreshHandler } = await import('../interactions');
        const fresh = new FreshHandler(notion, slack, userMapping, broadcast);
        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');

        await fresh.handleBlockAction(broadcastPayload('broadcast_send'));

        expect(slack.respondToInteraction).toHaveBeenCalledWith(
          'https://hooks.slack.com/actions/abc',
          expect.objectContaining({ text: expect.stringContaining('Only on-call admins') }),
        );
        expect(broadcast.buildPlan).not.toHaveBeenCalled();
        expect(slack.sendDM).not.toHaveBeenCalled();

        process.env.ONCALL_ADMINS = ORIGINAL;
        jest.resetModules();
      });

      it('rebuilds the plan and DMs each recipient when invoker is an admin', async () => {
        const ORIGINAL = process.env.ONCALL_ADMINS;
        process.env.ONCALL_ADMINS = 'alice@example.com';
        jest.resetModules();
        const { InteractionHandler: FreshHandler } = await import('../interactions');
        const fresh = new FreshHandler(notion, slack, userMapping, broadcast);

        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
        broadcast.buildPlan.mockResolvedValue({
          recipients: [
            {
              slackUserId: 'U_ALICE',
              personNotionId: 'p1',
              personEmail: 'alice@example.com',
              personName: 'Alice',
              shifts: [{ id: 's1', startDate: '2026-05-04', endDate: '2026-05-11' } as any],
            },
            {
              slackUserId: 'U_BOB',
              personNotionId: 'p2',
              personEmail: 'bob@example.com',
              personName: 'Bob',
              shifts: [{ id: 's2', startDate: '2026-06-01', endDate: '2026-06-08' } as any],
            },
          ],
          skipped: [],
        });
        slack.buildBroadcastDMBlocks = jest.fn().mockReturnValue([{ type: 'section' }]);

        await fresh.handleBlockAction(broadcastPayload('broadcast_send'));

        expect(broadcast.buildPlan).toHaveBeenCalledTimes(1);
        expect(slack.sendDM).toHaveBeenCalledTimes(2);
        expect(slack.sendDM).toHaveBeenCalledWith('U_ALICE', expect.any(String), expect.any(Array));
        expect(slack.sendDM).toHaveBeenCalledWith('U_BOB', expect.any(String), expect.any(Array));
        expect(slack.respondToInteraction).toHaveBeenCalledWith(
          'https://hooks.slack.com/actions/abc',
          expect.objectContaining({ text: expect.stringContaining('Broadcast complete') }),
        );

        process.env.ONCALL_ADMINS = ORIGINAL;
        jest.resetModules();
      });

      it('continues sending after a per-DM failure and reports it in the summary', async () => {
        const ORIGINAL = process.env.ONCALL_ADMINS;
        process.env.ONCALL_ADMINS = 'alice@example.com';
        jest.resetModules();
        const { InteractionHandler: FreshHandler } = await import('../interactions');
        const fresh = new FreshHandler(notion, slack, userMapping, broadcast);

        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
        broadcast.buildPlan.mockResolvedValue({
          recipients: [
            { slackUserId: 'U_A', personNotionId: 'p1', personEmail: 'a@x', personName: 'A', shifts: [] as any },
            { slackUserId: 'U_B', personNotionId: 'p2', personEmail: 'b@x', personName: 'B', shifts: [] as any },
          ],
          skipped: [],
        });
        slack.buildBroadcastDMBlocks = jest.fn().mockReturnValue([{ type: 'section' }]);
        slack.sendDM.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

        await fresh.handleBlockAction(broadcastPayload('broadcast_send'));

        const summary = (slack.respondToInteraction as jest.Mock).mock.calls[0][1];
        expect(summary.blocks[0].text.text).toContain('Sent to *1*');
        expect(summary.blocks[0].text.text).toContain('Failed for *1*');
        expect(summary.blocks[0].text.text).toContain('A');

        process.env.ONCALL_ADMINS = ORIGINAL;
        jest.resetModules();
      });
    });

    describe('broadcast_cancel', () => {
      it('replaces the ephemeral with a cancelled message — no admin check, no DMs', async () => {
        await handler.handleBlockAction(broadcastPayload('broadcast_cancel'));

        expect(slack.respondToInteraction).toHaveBeenCalledWith(
          'https://hooks.slack.com/actions/abc',
          expect.objectContaining({ text: expect.stringContaining('cancelled') }),
        );
        expect(broadcast.buildPlan).not.toHaveBeenCalled();
        expect(slack.sendDM).not.toHaveBeenCalled();
      });
    });

    describe('broadcast_request_replacement', () => {
      it('opens the same picker modal as /oncall replacement', async () => {
        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
        notion.getShiftsForPerson.mockResolvedValue([
          {
            id: 's1',
            personNotionId: 'p1',
            startDate: '2026-05-04',
            endDate: '2026-05-11',
            shiftType: 'Regular',
            status: 'Scheduled',
          } as any,
        ]);
        slack.buildReplacementPickerModal = jest
          .fn()
          .mockReturnValue({ type: 'modal', callback_id: 'replacement_select_shift' });

        await handler.handleBlockAction(broadcastPayload('broadcast_request_replacement'));

        expect(slack.buildReplacementPickerModal).toHaveBeenCalled();
        expect(slack.openModal).toHaveBeenCalledWith(
          'trigger-abc',
          expect.objectContaining({ callback_id: 'replacement_select_shift' }),
        );
      });

      it('DMs the user when they have no upcoming shifts', async () => {
        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
        notion.getShiftsForPerson.mockResolvedValue([]);

        await handler.handleBlockAction(broadcastPayload('broadcast_request_replacement'));

        expect(slack.sendDM).toHaveBeenCalledWith('U_ADMIN', expect.stringContaining('no upcoming shifts'));
      });
    });

    describe('broadcast_request_swap', () => {
      it('opens the same picker modal as /oncall swap', async () => {
        userMapping.getEmailBySlackId = jest.fn().mockResolvedValue('alice@example.com');
        notion.getShiftsForPerson.mockResolvedValue([
          {
            id: 's1',
            personNotionId: 'p1',
            startDate: '2026-05-04',
            endDate: '2026-05-11',
            shiftType: 'Regular',
            status: 'Scheduled',
          } as any,
        ]);
        slack.buildSwapPickerModal = jest.fn().mockReturnValue({ type: 'modal', callback_id: 'swap_select_shift' });

        await handler.handleBlockAction(broadcastPayload('broadcast_request_swap'));

        expect(slack.buildSwapPickerModal).toHaveBeenCalled();
        expect(slack.openModal).toHaveBeenCalledWith(
          'trigger-abc',
          expect.objectContaining({ callback_id: 'swap_select_shift' }),
        );
      });
    });
  });
});
