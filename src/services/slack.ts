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

  private previewText(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
  }

  async postToChannel(text: string, blocks?: any[]): Promise<void> {
    console.log(
      `[slack] postToChannel channel=${this.channelId} blocks=${blocks?.length ?? 0} text="${this.previewText(text)}"`,
    );
    const res = await this.client.chat.postMessage({
      channel: this.channelId,
      text,
      icon_emoji: ':slack_call:',
      ...(blocks && { blocks }),
    });
    console.log(`[slack] postToChannel sent ts=${res.ts} channel=${res.channel}`);
  }

  async updateMessage(channelId: string, ts: string, text: string, blocks?: any[]): Promise<void> {
    console.log(
      `[slack] updateMessage channel=${channelId} ts=${ts} blocks=${blocks?.length ?? 0} text="${this.previewText(text)}"`,
    );
    await this.client.chat.update({
      channel: channelId,
      ts,
      text,
      ...(blocks && { blocks }),
    });
    console.log(`[slack] updateMessage done channel=${channelId} ts=${ts}`);
  }

  async postEphemeral(channelId: string, userId: string, text: string, blocks?: any[]): Promise<void> {
    console.log(
      `[slack] postEphemeral channel=${channelId} user=${userId} blocks=${blocks?.length ?? 0} text="${this.previewText(text)}"`,
    );
    await this.client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text,
      ...(blocks && { blocks }),
    });
    console.log(`[slack] postEphemeral sent channel=${channelId} user=${userId}`);
  }

  async sendDM(userId: string, text: string, blocks?: any[]): Promise<void> {
    console.log(
      `[slack] sendDM user=${userId} blocks=${blocks?.length ?? 0} text="${this.previewText(text)}"`,
    );
    const result = await this.client.conversations.open({ users: userId });
    const dmChannelId = result.channel?.id;
    if (!dmChannelId) {
      console.error(`[slack] sendDM failed to open DM channel user=${userId}`);
      throw new Error(`Failed to open DM channel with user ${userId}`);
    }
    const res = await this.client.chat.postMessage({
      channel: dmChannelId,
      text,
      icon_emoji: ':slack_call:',
      ...(blocks && { blocks }),
    });
    console.log(`[slack] sendDM sent user=${userId} dmChannel=${dmChannelId} ts=${res.ts}`);
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
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Cancel', emoji: true },
            style: 'danger',
            action_id: 'switch_cancel',
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

  buildReplacementRequestBlocks(requesterName: string, shift: Shift, requestData: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${requesterName}* needs someone to cover their shift:\n:calendar: *${shift.startDate}* → *${shift.endDate}* (${shift.shiftType})`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: "I'll cover", emoji: true },
            style: 'primary',
            action_id: 'replacement_accept',
            value: requestData,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Cancel', emoji: true },
            style: 'danger',
            action_id: 'replacement_cancel',
            value: requestData,
          },
        ],
      },
    ];
  }

  buildSwapRequestBlocks(requesterName: string, shift: Shift, requestData: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${requesterName}* wants to swap their shift:\n:calendar: *${shift.startDate}* → *${shift.endDate}* (${shift.shiftType})\nPropose one of yours:`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Propose my shift', emoji: true },
            style: 'primary',
            action_id: 'swap_propose',
            value: requestData,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Cancel', emoji: true },
            style: 'danger',
            action_id: 'swap_cancel',
            value: requestData,
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
