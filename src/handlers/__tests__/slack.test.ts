import { SlackCommandHandler, SlashCommandPayload } from '../slack';
import { NotionService } from '../../services/notion';
import { SlackService } from '../../services/slack';
import { UserMappingService } from '../../services/userMapping';
import { BroadcastService } from '../../services/broadcast';
import { Shift, Constraint } from '../../types';

// --- Mock factories ---

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    name: 'Week 1',
    personNotionId: 'notion-1',
    personEmail: 'alice@example.com',
    personName: 'Alice',
    startDate: '2026-04-20',
    endDate: '2026-04-27',
    shiftType: 'Regular',
    status: 'Scheduled',
    ...overrides,
  };
}

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    id: 'constraint-1',
    personNotionId: 'notion-1',
    personEmail: 'alice@example.com',
    personName: 'Alice',
    startDate: '2026-05-01',
    endDate: '2026-05-05',
    reason: 'Vacation',
    status: 'Active',
    ...overrides,
  };
}

function makePayload(overrides: Partial<SlashCommandPayload> = {}): SlashCommandPayload {
  return {
    text: 'help',
    user_id: 'U123',
    user_name: 'alice',
    channel_id: 'C_ONCALL',
    trigger_id: 'trigger-abc',
    ...overrides,
  };
}

function createMocks() {
  const notion = {
    getActiveShift: jest.fn().mockResolvedValue(null),
    getUpcomingShifts: jest.fn().mockResolvedValue([]),
    getShiftsForPerson: jest.fn().mockResolvedValue([]),
    getConstraintsForPerson: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<NotionService>;

  const slack = {
    buildShiftListBlocks: jest
      .fn()
      .mockReturnValue([{ type: 'header', text: { type: 'plain_text', text: 'Schedule' } }]),
    buildConstraintModal: jest.fn().mockReturnValue({ type: 'modal', callback_id: 'add_constraint' }),
    buildReplacementPickerModal: jest.fn().mockReturnValue({ type: 'modal', callback_id: 'replacement_select_shift' }),
    buildSwapPickerModal: jest.fn().mockReturnValue({ type: 'modal', callback_id: 'swap_select_shift' }),
    buildBroadcastPreviewBlocks: jest
      .fn()
      .mockReturnValue([{ type: 'header', text: { type: 'plain_text', text: 'Broadcast preview' } }]),
    openModal: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SlackService>;

  const userMapping = {
    getEmailBySlackId: jest.fn().mockResolvedValue('alice@example.com'),
    getSlackMention: jest.fn().mockResolvedValue('<@U123>'),
    getSlackUserId: jest.fn().mockResolvedValue('U123'),
  } as unknown as jest.Mocked<UserMappingService>;

  const broadcast = {
    buildPlan: jest.fn().mockResolvedValue({ recipients: [], skipped: [] }),
  } as unknown as jest.Mocked<BroadcastService>;

  return { notion, slack, userMapping, broadcast };
}

describe('SlackCommandHandler', () => {
  let handler: SlackCommandHandler;
  let notion: jest.Mocked<NotionService>;
  let slack: jest.Mocked<SlackService>;
  let userMapping: jest.Mocked<UserMappingService>;
  let broadcast: jest.Mocked<BroadcastService>;

  beforeEach(() => {
    jest.clearAllMocks();
    const mocks = createMocks();
    notion = mocks.notion;
    slack = mocks.slack;
    userMapping = mocks.userMapping;
    broadcast = mocks.broadcast;
    handler = new SlackCommandHandler(notion, slack, userMapping, broadcast);
  });

  // 1. "list" returns upcoming shifts
  describe('list', () => {
    it('returns upcoming shifts with blocks', async () => {
      const active = makeShift({ status: 'Active' });
      const upcoming = makeShift({ id: 'shift-2', personName: 'Bob', startDate: '2026-04-27', endDate: '2026-05-04' });
      notion.getActiveShift.mockResolvedValue(active);
      notion.getUpcomingShifts.mockResolvedValue([upcoming]);

      const result = await handler.handle(makePayload({ text: 'list' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toBe('On-Call Schedule');
      expect(notion.getActiveShift).toHaveBeenCalled();
      expect(notion.getUpcomingShifts).toHaveBeenCalled();
      expect(slack.buildShiftListBlocks).toHaveBeenCalledWith([active, upcoming], 'On-Call Schedule');
      expect(result.blocks).toBeDefined();
    });
  });

  // 2. "now" with active shift returns person mention
  describe('now', () => {
    it('returns person mention when there is an active shift', async () => {
      const active = makeShift({ status: 'Active', personEmail: 'alice@example.com' });
      notion.getActiveShift.mockResolvedValue(active);
      userMapping.getSlackMention.mockResolvedValue('<@U123>');

      const result = await handler.handle(makePayload({ text: 'now' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('<@U123>');
      expect(result.text).toContain('2026-04-20');
      expect(result.text).toContain('2026-04-27');
      expect(userMapping.getSlackMention).toHaveBeenCalledWith('alice@example.com');
    });

    // 3. "now" with no active shift
    it('returns "No one is currently on-call" when no active shift', async () => {
      notion.getActiveShift.mockResolvedValue(null);

      const result = await handler.handle(makePayload({ text: 'now' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toBe('No one is currently on-call.');
    });
  });

  // 4. "help" returns command reference
  describe('help', () => {
    it('returns command reference', async () => {
      const result = await handler.handle(makePayload({ text: 'help' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('list');
      expect(result.text).toContain('mine');
      expect(result.text).toContain('now');
      expect(result.text).toContain('replacement');
      expect(result.text).toContain('swap');
      expect(result.text).toContain('block');
      expect(result.text).toContain('my-blocks');
      expect(result.text).toContain('help');
    });
  });

  // 5. Unknown subcommand returns help
  describe('unknown subcommand', () => {
    it('returns help for unknown subcommand', async () => {
      const result = await handler.handle(makePayload({ text: 'foobar' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('On-Call Bot Commands');
    });
  });

  // 6. "block" opens a modal
  describe('block', () => {
    it('opens a modal and returns acknowledgment', async () => {
      const result = await handler.handle(makePayload({ text: 'block', trigger_id: 'trigger-xyz' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('Opening block dates form');
      expect(slack.buildConstraintModal).toHaveBeenCalledWith('trigger-xyz');
      expect(slack.openModal).toHaveBeenCalledWith('trigger-xyz', { type: 'modal', callback_id: 'add_constraint' });
    });
  });

  // Additional coverage
  describe('mine', () => {
    it('returns shifts for the calling user', async () => {
      const shifts = [makeShift()];
      notion.getShiftsForPerson.mockResolvedValue(shifts);

      const result = await handler.handle(makePayload({ text: 'mine', user_id: 'U123' }));

      expect(result.response_type).toBe('ephemeral');
      expect(userMapping.getEmailBySlackId).toHaveBeenCalledWith('U123');
      expect(notion.getShiftsForPerson).toHaveBeenCalledWith('alice@example.com');
      expect(slack.buildShiftListBlocks).toHaveBeenCalledWith(shifts, 'Your Shifts');
    });

    it('returns error when email lookup fails', async () => {
      userMapping.getEmailBySlackId.mockResolvedValue(null);

      const result = await handler.handle(makePayload({ text: 'mine' }));

      expect(result.text).toContain('Could not find your email');
    });
  });

  describe('replacement', () => {
    it('returns no shifts message when user has no upcoming shifts', async () => {
      notion.getShiftsForPerson.mockResolvedValue([]);
      const result = await handler.handle(makePayload({ text: 'replacement' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('no upcoming shifts');
    });

    it('opens modal when user has shifts', async () => {
      const shift = makeShift({ status: 'Scheduled' });
      notion.getShiftsForPerson.mockResolvedValue([shift]);

      const result = await handler.handle(makePayload({ text: 'replacement' }));

      expect(result.text).toContain('Opening shift picker');
      expect(slack.openModal).toHaveBeenCalledWith(
        'trigger-abc',
        expect.objectContaining({ callback_id: 'replacement_select_shift' }),
      );
    });
  });

  describe('swap', () => {
    it('returns no shifts message when user has no upcoming shifts', async () => {
      notion.getShiftsForPerson.mockResolvedValue([]);
      const result = await handler.handle(makePayload({ text: 'swap' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('no upcoming shifts');
    });

    it('opens modal when user has shifts', async () => {
      const shift = makeShift({ status: 'Scheduled' });
      notion.getShiftsForPerson.mockResolvedValue([shift]);

      const result = await handler.handle(makePayload({ text: 'swap' }));

      expect(result.text).toContain('Opening shift picker');
      expect(slack.openModal).toHaveBeenCalledWith(
        'trigger-abc',
        expect.objectContaining({ callback_id: 'swap_select_shift' }),
      );
    });
  });

  describe('my-blocks', () => {
    it('returns blocked dates for the calling user', async () => {
      const constraints = [makeConstraint()];
      notion.getConstraintsForPerson.mockResolvedValue(constraints);

      const result = await handler.handle(makePayload({ text: 'my-blocks' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('2026-05-01');
      expect(result.text).toContain('Vacation');
    });

    it('returns message when no blocked dates found', async () => {
      notion.getConstraintsForPerson.mockResolvedValue([]);

      const result = await handler.handle(makePayload({ text: 'my-blocks' }));

      expect(result.text).toContain('no blocked dates');
    });
  });

  describe('empty text', () => {
    it('defaults to help', async () => {
      const result = await handler.handle(makePayload({ text: '' }));

      expect(result.text).toContain('On-Call Bot Commands');
    });
  });

  describe('broadcast', () => {
    it('returns error when invoker has no email mapping', async () => {
      userMapping.getEmailBySlackId.mockResolvedValue(null);

      const result = await handler.handle(makePayload({ text: 'broadcast' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('Could not find your email');
      expect(broadcast.buildPlan).not.toHaveBeenCalled();
    });

    it('builds the plan and renders the preview blocks', async () => {
      const plan = {
        recipients: [
          {
            slackUserId: 'U_ALICE',
            personNotionId: 'p1',
            personEmail: 'alice@example.com',
            personName: 'Alice',
            shifts: [makeShift({ id: 's1' })],
          },
        ],
        skipped: [],
      };
      broadcast.buildPlan.mockResolvedValue(plan);

      const result = await handler.handle(makePayload({ text: 'broadcast' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('1 recipient');
      expect(broadcast.buildPlan).toHaveBeenCalledTimes(1);
      expect(slack.buildBroadcastPreviewBlocks).toHaveBeenCalledWith(plan, expect.any(Boolean));
    });

    it('treats invoker as admin when their email is in ONCALL_ADMINS (case-insensitive)', async () => {
      const ORIGINAL = process.env.ONCALL_ADMINS;
      process.env.ONCALL_ADMINS = 'ALICE@example.com';
      jest.resetModules();
      // Re-import the handler module so it picks up the refreshed config.
      const { SlackCommandHandler: FreshHandler } = await import('../slack');
      const fresh = new FreshHandler(notion, slack, userMapping, broadcast);

      await fresh.handle(makePayload({ text: 'broadcast' }));

      expect(slack.buildBroadcastPreviewBlocks).toHaveBeenCalledWith(expect.anything(), true);

      process.env.ONCALL_ADMINS = ORIGINAL;
      jest.resetModules();
    });

    it('treats invoker as non-admin when their email is not in ONCALL_ADMINS', async () => {
      const ORIGINAL = process.env.ONCALL_ADMINS;
      process.env.ONCALL_ADMINS = 'someone-else@example.com';
      jest.resetModules();
      const { SlackCommandHandler: FreshHandler } = await import('../slack');
      const fresh = new FreshHandler(notion, slack, userMapping, broadcast);

      await fresh.handle(makePayload({ text: 'broadcast' }));

      expect(slack.buildBroadcastPreviewBlocks).toHaveBeenCalledWith(expect.anything(), false);

      process.env.ONCALL_ADMINS = ORIGINAL;
      jest.resetModules();
    });
  });
});
