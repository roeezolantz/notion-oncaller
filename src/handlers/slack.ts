import { NotionService } from '../services/notion';
import { SlackService } from '../services/slack';
import { UserMappingService } from '../services/userMapping';
import { Shift, Constraint } from '../types';

export interface SlashCommandPayload {
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  trigger_id: string;
}

export interface SlashCommandResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: any[];
}

export class SlackCommandHandler {
  constructor(
    private notion: NotionService,
    private slack: SlackService,
    private userMapping: UserMappingService,
  ) {}

  async handle(payload: SlashCommandPayload): Promise<SlashCommandResponse> {
    const parts = payload.text.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || 'help';

    switch (subcommand) {
      case 'list':
        return this.handleList();
      case 'mine':
        return this.handleMine(payload.user_id);
      case 'now':
        return this.handleNow();
      case 'switch':
        return this.handleSwitch(payload.user_id, payload.trigger_id, parts.slice(1));
      case 'block':
        return this.handleBlock(payload.trigger_id);
      case 'my-blocks':
        return this.handleMyBlocks(payload.user_id);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  }

  private async handleList(): Promise<SlashCommandResponse> {
    const [activeShift, upcomingShifts] = await Promise.all([
      this.notion.getActiveShift(),
      this.notion.getUpcomingShifts(),
    ]);

    const allShifts: Shift[] = [];
    if (activeShift) {
      allShifts.push(activeShift);
    }
    allShifts.push(...upcomingShifts);

    const blocks = this.slack.buildShiftListBlocks(allShifts, 'On-Call Schedule');

    return {
      response_type: 'ephemeral',
      text: 'On-Call Schedule',
      blocks,
    };
  }

  private async handleMine(slackUserId: string): Promise<SlashCommandResponse> {
    const email = await this.userMapping.getEmailBySlackId(slackUserId);
    if (!email) {
      return {
        response_type: 'ephemeral',
        text: 'Could not find your email address. Please contact an admin.',
      };
    }

    const shifts = await this.notion.getShiftsForPerson(email);
    const blocks = this.slack.buildShiftListBlocks(shifts, 'Your Shifts');

    return {
      response_type: 'ephemeral',
      text: 'Your Shifts',
      blocks,
    };
  }

  private async handleNow(): Promise<SlashCommandResponse> {
    const activeShift = await this.notion.getActiveShift();

    if (!activeShift) {
      return {
        response_type: 'ephemeral',
        text: 'No one is currently on-call.',
      };
    }

    const mention = await this.userMapping.getSlackMention(activeShift.personEmail);
    return {
      response_type: 'ephemeral',
      text: `Currently on-call: ${mention} (${activeShift.startDate} - ${activeShift.endDate})`,
    };
  }

  private async handleSwitch(slackUserId: string, triggerId: string, args: string[]): Promise<SlashCommandResponse> {
    const email = await this.userMapping.getEmailBySlackId(slackUserId);
    if (!email) {
      return { response_type: 'ephemeral', text: 'Could not find your Notion account.' };
    }

    const myShifts = await this.notion.getShiftsForPerson(email);
    const upcoming = myShifts.filter((s) => s.status === 'Scheduled');
    if (upcoming.length === 0) {
      return { response_type: 'ephemeral', text: 'You have no upcoming shifts to switch.' };
    }

    // Extract target if provided: /oncall switch @user
    const targetArg = args[0];
    let targetSlackId = '';
    if (targetArg) {
      const match = targetArg.match(/^<@([A-Z0-9]+)(?:\|[^>]*)?>/);
      targetSlackId = match ? match[1] : targetArg.replace(/[<@>]/g, '');
    }

    // Build shift options for the modal dropdown
    const shiftOptions = upcoming.map((s) => ({
      text: { type: 'plain_text' as const, text: `${s.startDate} → ${s.endDate} (${s.shiftType})` },
      value: JSON.stringify({ shiftId: s.id, personId: s.personNotionId, startDate: s.startDate, endDate: s.endDate }),
    }));

    const modal: any = {
      type: 'modal',
      callback_id: 'switch_select_shift',
      title: { type: 'plain_text', text: 'Switch Shift' },
      submit: { type: 'plain_text', text: 'Request Switch' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ email, targetSlackId }),
      blocks: [
        {
          type: 'input',
          block_id: 'shift_select_block',
          label: { type: 'plain_text', text: 'Which shift do you want to switch?' },
          element: {
            type: 'static_select',
            action_id: 'shift_select',
            options: shiftOptions,
            ...(shiftOptions.length === 1 && { initial_option: shiftOptions[0] }),
          },
        },
      ],
    };

    // If no target specified, add a broadcast/direct choice
    if (!targetSlackId) {
      modal.blocks.push({
        type: 'input',
        block_id: 'switch_target_block',
        optional: true,
        label: { type: 'plain_text', text: 'Swap with someone specific? (leave empty to broadcast)' },
        element: {
          type: 'users_select',
          action_id: 'switch_target',
          placeholder: { type: 'plain_text', text: 'Select a person (optional)' },
        },
      });
    }

    await this.slack.openModal(triggerId, modal);
    return { response_type: 'ephemeral', text: 'Opening shift picker...' };
  }

  private async handleBlock(triggerId: string): Promise<SlashCommandResponse> {
    const modal = this.slack.buildConstraintModal(triggerId);
    await this.slack.openModal(triggerId, modal);

    return {
      response_type: 'ephemeral',
      text: 'Opening block dates form...',
    };
  }

  private async handleMyBlocks(slackUserId: string): Promise<SlashCommandResponse> {
    const email = await this.userMapping.getEmailBySlackId(slackUserId);
    if (!email) {
      return {
        response_type: 'ephemeral',
        text: 'Could not find your email address. Please contact an admin.',
      };
    }

    const constraints = await this.notion.getConstraintsForPerson(email);

    if (constraints.length === 0) {
      return {
        response_type: 'ephemeral',
        text: 'You have no blocked dates.',
      };
    }

    const lines = constraints.map(
      (c) => `- *${c.startDate}* to *${c.endDate}*${c.reason ? ` — ${c.reason}` : ''}`,
    );

    return {
      response_type: 'ephemeral',
      text: `:no_entry_sign: *Your Blocked Dates:*\n${lines.join('\n')}`,
    };
  }

  private async handleHelp(): Promise<SlashCommandResponse> {
    const text = [
      '*On-Call Bot Commands:*',
      '`list` — Show current and upcoming on-call shifts',
      '`mine` — Show your upcoming shifts',
      '`now` — Show who is currently on-call',
      '`switch` — Request a shift switch',
      '`switch @user` — Request a direct shift switch with someone',
      '`block` — Block out dates you\'re unavailable',
      '`my-blocks` — Show your blocked dates',
      '`help` — Show this command reference',
    ].join('\n');

    return {
      response_type: 'ephemeral',
      text,
    };
  }
}
