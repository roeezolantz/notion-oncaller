import { WebClient } from '@slack/web-api';
import { Shift } from '../types';

export class SlackService {
  private client: WebClient;
  private channelId: string;
  private usergroupId: string;

  constructor(client: WebClient, channelId: string, usergroupId: string) {
    this.client = client;
    this.channelId = channelId;
    this.usergroupId = usergroupId;
  }

  // Core messaging

  async postToChannel(text: string, blocks?: any[]): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text,
      icon_emoji: ':slack_call:',
      ...(blocks && { blocks }),
    });
  }

  async postEphemeral(channelId: string, userId: string, text: string, blocks?: any[]): Promise<void> {
    await this.client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text,
      ...(blocks && { blocks }),
    });
  }

  async sendDM(userId: string, text: string, blocks?: any[]): Promise<void> {
    const result = await this.client.conversations.open({ users: userId });
    const dmChannelId = result.channel?.id;
    if (!dmChannelId) {
      throw new Error(`Failed to open DM channel with user ${userId}`);
    }
    await this.client.chat.postMessage({
      channel: dmChannelId,
      text,
      icon_emoji: ':slack_call:',
      ...(blocks && { blocks }),
    });
  }

  async updateOncallGroup(slackUserId: string): Promise<void> {
    await this.client.usergroups.users.update({
      usergroup: this.usergroupId,
      users: slackUserId,
    });
  }

  async openModal(triggerId: string, view: any): Promise<void> {
    await this.client.views.open({
      trigger_id: triggerId,
      view,
    });
  }

  // Block/message builders

  buildShiftListBlocks(shifts: Shift[], title: string): any[] {
    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: title, emoji: true },
      },
    ];

    if (shifts.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No shifts found._' },
      });
      return blocks;
    }

    for (const shift of shifts) {
      const typeEmoji = shift.shiftType === 'Holiday' ? ':palm_tree:' : ':calendar:';
      const statusEmoji = shift.status === 'Active' ? ':large_green_circle:' : ':white_circle:';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} ${typeEmoji} *${shift.personName}*\n${shift.startDate} → ${shift.endDate} | ${shift.shiftType} | ${shift.status}`,
        },
      });
    }

    return blocks;
  }

  buildSwitchRequestBlocks(requesterName: string, shift: Shift, requestId: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${requesterName}* is looking for someone to cover their shift:\n:calendar: *${shift.startDate}* → *${shift.endDate}* (${shift.shiftType})`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: "I'll cover", emoji: true },
            style: 'primary',
            action_id: 'switch_accept',
            value: requestId,
          },
        ],
      },
    ];
  }

  buildDirectSwitchBlocks(requesterName: string, shiftA: Shift, shiftB: Shift, requestId: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${requesterName}* wants to switch shifts:\n:arrow_right: *Their shift:* ${shiftA.startDate} → ${shiftA.endDate} (${shiftA.shiftType})\n:arrow_left: *Your shift:* ${shiftB.startDate} → ${shiftB.endDate} (${shiftB.shiftType})`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve', emoji: true },
            style: 'primary',
            action_id: 'switch_approve',
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Decline', emoji: true },
            style: 'danger',
            action_id: 'switch_decline',
            value: requestId,
          },
        ],
      },
    ];
  }

  buildConstraintModal(triggerId: string): any {
    return {
      type: 'modal',
      callback_id: 'add_constraint',
      title: { type: 'plain_text', text: 'Add Constraint' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'start_date_block',
          element: {
            type: 'datepicker',
            action_id: 'start_date',
            placeholder: { type: 'plain_text', text: 'Select start date' },
          },
          label: { type: 'plain_text', text: 'Start Date' },
        },
        {
          type: 'input',
          block_id: 'end_date_block',
          element: {
            type: 'datepicker',
            action_id: 'end_date',
            placeholder: { type: 'plain_text', text: 'Select end date' },
          },
          label: { type: 'plain_text', text: 'End Date' },
        },
        {
          type: 'input',
          block_id: 'reason_block',
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'reason',
            placeholder: { type: 'plain_text', text: 'Why are you unavailable?' },
          },
          label: { type: 'plain_text', text: 'Reason' },
        },
      ],
    };
  }
}
