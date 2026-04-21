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
        return this.handleSwitch();
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

  private async handleSwitch(): Promise<SlashCommandResponse> {
    return {
      response_type: 'ephemeral',
      text: 'Working on it...',
    };
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
