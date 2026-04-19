import { SlackCommandHandler, SlashCommandPayload } from '../slack';
import { NotionService } from '../../services/notion';
import { SlackService } from '../../services/slack';
import { UserMappingService } from '../../services/userMapping';
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
    buildShiftListBlocks: jest.fn().mockReturnValue([{ type: 'header', text: { type: 'plain_text', text: 'Schedule' } }]),
    buildConstraintModal: jest.fn().mockReturnValue({ type: 'modal', callback_id: 'add_constraint' }),
    openModal: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SlackService>;

  const userMapping = {
    getEmailBySlackId: jest.fn().mockResolvedValue('alice@example.com'),
    getSlackMention: jest.fn().mockResolvedValue('<@U123>'),
    getSlackUserId: jest.fn().mockResolvedValue('U123'),
  } as unknown as jest.Mocked<UserMappingService>;

  return { notion, slack, userMapping };
}

describe('SlackCommandHandler', () => {
  let handler: SlackCommandHandler;
  let notion: jest.Mocked<NotionService>;
  let slack: jest.Mocked<SlackService>;
  let userMapping: jest.Mocked<UserMappingService>;

  beforeEach(() => {
    jest.clearAllMocks();
    const mocks = createMocks();
    notion = mocks.notion;
    slack = mocks.slack;
    userMapping = mocks.userMapping;
    handler = new SlackCommandHandler(notion, slack, userMapping);
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
      expect(slack.buildShiftListBlocks).toHaveBeenCalledWith(
        [active, upcoming],
        'On-Call Schedule',
      );
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
      expect(result.text).toContain('switch');
      expect(result.text).toContain('add-constraint');
      expect(result.text).toContain('my-constraints');
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

  // 6. "add-constraint" opens a modal
  describe('add-constraint', () => {
    it('opens a modal and returns acknowledgment', async () => {
      const result = await handler.handle(makePayload({ text: 'add-constraint', trigger_id: 'trigger-xyz' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('Opening constraint form');
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

  describe('switch', () => {
    it('returns deferred response', async () => {
      const result = await handler.handle(makePayload({ text: 'switch' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toBe('Working on it...');
    });

    it('returns deferred response for switch @user', async () => {
      const result = await handler.handle(makePayload({ text: 'switch @bob' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toBe('Working on it...');
    });
  });

  describe('my-constraints', () => {
    it('returns constraints for the calling user', async () => {
      const constraints = [makeConstraint()];
      notion.getConstraintsForPerson.mockResolvedValue(constraints);

      const result = await handler.handle(makePayload({ text: 'my-constraints' }));

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('2026-05-01');
      expect(result.text).toContain('Vacation');
    });

    it('returns message when no constraints found', async () => {
      notion.getConstraintsForPerson.mockResolvedValue([]);

      const result = await handler.handle(makePayload({ text: 'my-constraints' }));

      expect(result.text).toContain('no active constraints');
    });
  });

  describe('empty text', () => {
    it('defaults to help', async () => {
      const result = await handler.handle(makePayload({ text: '' }));

      expect(result.text).toContain('On-Call Bot Commands');
    });
  });
});
