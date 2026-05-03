import { SlackService } from '../slack';
import { Shift } from '../../types';

const mockPostMessage = jest.fn().mockResolvedValue({ ok: true });
const mockPostEphemeral = jest.fn().mockResolvedValue({ ok: true });
const mockConversationsOpen = jest.fn().mockResolvedValue({ channel: { id: 'DM123' } });
const mockUsergroupsUsersUpdate = jest.fn().mockResolvedValue({ ok: true });
const mockViewsOpen = jest.fn().mockResolvedValue({ ok: true });

const mockClient = {
  chat: {
    postMessage: mockPostMessage,
    postEphemeral: mockPostEphemeral,
  },
  conversations: {
    open: mockConversationsOpen,
  },
  usergroups: {
    users: {
      update: mockUsergroupsUsersUpdate,
    },
  },
  views: {
    open: mockViewsOpen,
  },
} as any;

const CHANNEL_ID = 'C_ONCALL';
const USERGROUP_ID = 'S_ONCALL';

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

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SlackService(mockClient, CHANNEL_ID, USERGROUP_ID);
  });

  // --- Core messaging ---

  describe('postToChannel', () => {
    it('posts a text message to the configured channel', async () => {
      await service.postToChannel('Hello oncall');

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: CHANNEL_ID,
        text: 'Hello oncall',
        icon_emoji: ':slack_call:',
      });
    });

    it('includes blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
      await service.postToChannel('fallback', blocks);

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: CHANNEL_ID,
        text: 'fallback',
        icon_emoji: ':slack_call:',
        blocks,
      });
    });
  });

  describe('postEphemeral', () => {
    it('sends an ephemeral message to a specific user in a channel', async () => {
      await service.postEphemeral('C_OTHER', 'U123', 'Only you see this');

      expect(mockPostEphemeral).toHaveBeenCalledWith({
        channel: 'C_OTHER',
        user: 'U123',
        text: 'Only you see this',
      });
    });

    it('includes blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'secret' } }];
      await service.postEphemeral('C_OTHER', 'U123', 'fallback', blocks);

      expect(mockPostEphemeral).toHaveBeenCalledWith({
        channel: 'C_OTHER',
        user: 'U123',
        text: 'fallback',
        blocks,
      });
    });
  });

  describe('sendDM', () => {
    it('opens a DM channel and posts a message', async () => {
      await service.sendDM('U456', 'Hey there');

      expect(mockConversationsOpen).toHaveBeenCalledWith({ users: 'U456' });
      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'DM123',
        text: 'Hey there',
        icon_emoji: ':slack_call:',
      });
    });

    it('includes blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'dm blocks' } }];
      await service.sendDM('U456', 'fallback', blocks);

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'DM123',
        text: 'fallback',
        icon_emoji: ':slack_call:',
        blocks,
      });
    });

    it('throws when conversations.open fails to return a channel', async () => {
      mockConversationsOpen.mockResolvedValueOnce({ channel: {} });

      await expect(service.sendDM('U_BAD', 'hi')).rejects.toThrow('Failed to open DM channel with user U_BAD');
    });
  });

  describe('updateOncallGroup', () => {
    it('updates the usergroup with the given Slack user ID', async () => {
      await service.updateOncallGroup('U789');

      expect(mockUsergroupsUsersUpdate).toHaveBeenCalledWith({
        usergroup: USERGROUP_ID,
        users: 'U789',
      });
    });
  });

  describe('openModal', () => {
    it('opens a modal view with the given trigger ID', async () => {
      const view = { type: 'modal', title: { type: 'plain_text', text: 'Test' } };
      await service.openModal('trigger-abc', view);

      expect(mockViewsOpen).toHaveBeenCalledWith({
        trigger_id: 'trigger-abc',
        view,
      });
    });
  });

  // --- Block builders ---

  describe('buildShiftListBlocks', () => {
    it('returns a header and empty message when no shifts', () => {
      const blocks = service.buildShiftListBlocks([], 'On-Call Schedule');

      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('header');
      expect(blocks[0].text.text).toBe('On-Call Schedule');
      expect(blocks[1].text.text).toContain('No shifts found');
    });

    it('renders shifts with correct emojis for Regular/Scheduled', () => {
      const shift = makeShift({ shiftType: 'Regular', status: 'Scheduled' });
      const blocks = service.buildShiftListBlocks([shift], 'Schedule');

      const shiftBlock = blocks[1];
      expect(shiftBlock.text.text).toContain(':white_circle:');
      expect(shiftBlock.text.text).toContain(':calendar:');
      expect(shiftBlock.text.text).toContain('Alice');
    });

    it('renders Holiday + Active shift with correct emojis', () => {
      const shift = makeShift({ shiftType: 'Holiday', status: 'Active' });
      const blocks = service.buildShiftListBlocks([shift], 'Schedule');

      const shiftBlock = blocks[1];
      expect(shiftBlock.text.text).toContain(':large_green_circle:');
      expect(shiftBlock.text.text).toContain(':palm_tree:');
    });

    it('renders multiple shifts', () => {
      const shifts = [makeShift(), makeShift({ id: 'shift-2', personName: 'Bob' })];
      const blocks = service.buildShiftListBlocks(shifts, 'All');

      // header + 2 shift sections
      expect(blocks).toHaveLength(3);
    });
  });

  describe('buildSwitchRequestBlocks', () => {
    it('builds blocks with requester name, shift details, and accept button', () => {
      const shift = makeShift();
      const blocks = service.buildSwitchRequestBlocks('Alice', shift, 'req-1');

      expect(blocks).toHaveLength(2);

      // Section with shift info
      const section = blocks[0];
      expect(section.type).toBe('section');
      expect(section.text.text).toContain('Alice');
      expect(section.text.text).toContain('2026-04-20');
      expect(section.text.text).toContain('2026-04-27');

      // Actions with accept button
      const actions = blocks[1];
      expect(actions.type).toBe('actions');
      const button = actions.elements[0];
      expect(button.action_id).toBe('switch_accept');
      expect(button.style).toBe('primary');
      expect(button.value).toBe('req-1');
    });
  });

  describe('buildDirectSwitchBlocks', () => {
    it('builds blocks with both shifts and approve/decline buttons', () => {
      const shiftA = makeShift({ personName: 'Alice' });
      const shiftB = makeShift({ id: 'shift-2', personName: 'Bob', startDate: '2026-05-01', endDate: '2026-05-08' });
      const blocks = service.buildDirectSwitchBlocks('Alice', shiftA, shiftB, 'req-2');

      expect(blocks).toHaveLength(2);

      // Section with both shifts
      const section = blocks[0];
      expect(section.text.text).toContain('Alice');
      expect(section.text.text).toContain('2026-04-20');
      expect(section.text.text).toContain('2026-05-01');

      // Actions with approve/decline
      const actions = blocks[1];
      expect(actions.elements).toHaveLength(2);

      const approveBtn = actions.elements[0];
      expect(approveBtn.action_id).toBe('switch_approve');
      expect(approveBtn.style).toBe('primary');
      expect(approveBtn.value).toBe('req-2');

      const declineBtn = actions.elements[1];
      expect(declineBtn.action_id).toBe('switch_decline');
      expect(declineBtn.style).toBe('danger');
      expect(declineBtn.value).toBe('req-2');
    });
  });

  describe('buildReplacementRequestBlocks', () => {
    it('builds blocks with requester name, shift details, and cover/cancel buttons', () => {
      const shift = makeShift();
      const blocks = service.buildReplacementRequestBlocks('Alice', shift, 'req-r1');

      expect(blocks).toHaveLength(2);

      const section = blocks[0];
      expect(section.type).toBe('section');
      expect(section.text.text).toContain('Alice');
      expect(section.text.text).toContain('2026-04-20');

      const actions = blocks[1];
      expect(actions.type).toBe('actions');
      expect(actions.elements[0].action_id).toBe('replacement_accept');
      expect(actions.elements[0].value).toBe('req-r1');
      expect(actions.elements[1].action_id).toBe('replacement_cancel');
    });
  });

  describe('buildSwapRequestBlocks', () => {
    it('builds blocks with requester name, shift details, and propose/cancel buttons', () => {
      const shift = makeShift();
      const blocks = service.buildSwapRequestBlocks('Alice', shift, 'req-s1');

      expect(blocks).toHaveLength(2);

      const section = blocks[0];
      expect(section.type).toBe('section');
      expect(section.text.text).toContain('Alice');
      expect(section.text.text).toContain('swap');

      const actions = blocks[1];
      expect(actions.type).toBe('actions');
      expect(actions.elements[0].action_id).toBe('swap_propose');
      expect(actions.elements[0].value).toBe('req-s1');
      expect(actions.elements[1].action_id).toBe('swap_cancel');
    });
  });

  describe('buildConstraintModal', () => {
    it('returns a modal with correct callback_id and input blocks', () => {
      const modal = service.buildConstraintModal('trigger-xyz');

      expect(modal.type).toBe('modal');
      expect(modal.callback_id).toBe('add_constraint');
      expect(modal.blocks).toHaveLength(3);

      // Start date
      expect(modal.blocks[0].element.type).toBe('datepicker');
      expect(modal.blocks[0].element.action_id).toBe('start_date');

      // End date
      expect(modal.blocks[1].element.type).toBe('datepicker');
      expect(modal.blocks[1].element.action_id).toBe('end_date');

      // Reason (optional)
      expect(modal.blocks[2].element.type).toBe('plain_text_input');
      expect(modal.blocks[2].element.action_id).toBe('reason');
      expect(modal.blocks[2].optional).toBe(true);
    });
  });

  describe('buildBroadcastDMBlocks', () => {
    const recipient = {
      slackUserId: 'U_ALICE',
      personNotionId: 'p1',
      personEmail: 'alice@example.com',
      personName: 'Alice',
      shifts: [
        makeShift({ id: 's1', startDate: '2026-05-04', endDate: '2026-05-11' }),
        makeShift({ id: 's2', startDate: '2026-06-15', endDate: '2026-06-22' }),
      ],
    };

    it('renders header, bulleted shifts, and View/Replacement/Swap action buttons', () => {
      const blocks = service.buildBroadcastDMBlocks(recipient, 'https://notion.so/schedule');

      expect(blocks).toHaveLength(3);

      const header = blocks[0];
      expect(header.type).toBe('section');
      expect(header.text.text).toContain('updated on-call schedule');

      const list = blocks[1];
      expect(list.type).toBe('section');
      expect(list.text.text).toContain('• 2026-05-04 → 2026-05-11');
      expect(list.text.text).toContain('• 2026-06-15 → 2026-06-22');

      const actions = blocks[2];
      expect(actions.type).toBe('actions');
      expect(actions.elements).toHaveLength(3);
      expect(actions.elements[0].url).toBe('https://notion.so/schedule');
      expect(actions.elements[1].action_id).toBe('broadcast_request_replacement');
      expect(actions.elements[2].action_id).toBe('broadcast_request_swap');
    });

    it('omits the View Full Schedule button when scheduleUrl is empty', () => {
      const blocks = service.buildBroadcastDMBlocks(recipient, '');
      const actions = blocks[blocks.length - 1];
      const urls = actions.elements.filter((e: any) => e.type === 'button' && 'url' in e);
      expect(urls).toEqual([]);
    });
  });

  describe('buildBroadcastPreviewBlocks', () => {
    const recipientA = {
      slackUserId: 'U_ALICE',
      personNotionId: 'p1',
      personEmail: 'alice@example.com',
      personName: 'Alice',
      shifts: [makeShift({ id: 's1', startDate: '2026-05-04', endDate: '2026-05-11' })],
    };
    const recipientB = {
      slackUserId: 'U_BOB',
      personNotionId: 'p2',
      personEmail: 'bob@example.com',
      personName: 'Bob',
      shifts: [makeShift({ id: 's2', startDate: '2026-07-01', endDate: '2026-07-08' })],
    };

    it('renders Send + Cancel buttons for admins', () => {
      const blocks = service.buildBroadcastPreviewBlocks({ recipients: [recipientA, recipientB], skipped: [] }, true);

      const actions = blocks.find((b) => b.type === 'actions');
      expect(actions).toBeDefined();
      expect(actions.elements.map((e: any) => e.action_id)).toEqual(['broadcast_send', 'broadcast_cancel']);
    });

    it('omits action buttons and includes admin-only notice for non-admins', () => {
      const blocks = service.buildBroadcastPreviewBlocks({ recipients: [recipientA], skipped: [] }, false);

      expect(blocks.find((b) => b.type === 'actions')).toBeUndefined();
      const noticeText = JSON.stringify(blocks);
      expect(noticeText).toContain('Only on-call admins');
    });

    it('lists skipped people with their reason', () => {
      const blocks = service.buildBroadcastPreviewBlocks(
        {
          recipients: [recipientA],
          skipped: [{ personEmail: 'ghost@example.com', personName: 'Ghost', reason: 'no_slack_mapping' }],
        },
        true,
      );
      const text = JSON.stringify(blocks);
      expect(text).toContain('Ghost');
      expect(text).toContain('no Slack mapping');
    });

    it('shows an empty-state message and no Send button when nobody is up for broadcast', () => {
      const blocks = service.buildBroadcastPreviewBlocks({ recipients: [], skipped: [] }, true);

      expect(blocks.find((b) => b.type === 'actions')).toBeUndefined();
      expect(JSON.stringify(blocks)).toContain('No one has upcoming shifts');
    });
  });

  describe('respondToInteraction', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('POSTs the body to the Slack response_url with replace_original true by default', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      await service.respondToInteraction('https://hooks.slack.com/actions/abc', {
        text: 'done',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'done' } }],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/actions/abc');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(init.body);
      expect(body.replace_original).toBe(true);
      expect(body.text).toBe('done');
    });
  });
});
