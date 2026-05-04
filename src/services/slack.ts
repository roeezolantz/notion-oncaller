import { WebClient } from '@slack/web-api';
import { Shift } from '../types';
import { BroadcastPlan, BroadcastRecipient } from './broadcast';

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
    console.log(`[slack] sendDM user=${userId} blocks=${blocks?.length ?? 0} text="${this.previewText(text)}"`);
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

  /**
   * POSTs to a Slack interaction `response_url` to update or replace the
   * original ephemeral/in-channel message. Slack's `response_url` is valid
   * for 30 minutes after the interaction.
   *
   * Defaults to `replace_original: true` so callers can simply pass the new
   * message body.
   */
  async respondToInteraction(
    responseUrl: string,
    body: { text: string; blocks?: any[]; replace_original?: boolean; response_type?: 'ephemeral' | 'in_channel' },
  ): Promise<void> {
    const payload = { replace_original: true, ...body };
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack response_url POST failed: ${res.status} ${text}`);
    }
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

  /**
   * Per-recipient DM blocks for `/oncall broadcast`: a header line, the
   * recipient's bulleted upcoming shifts, and action buttons (View Schedule,
   * Request Replacement, Request Swap).
   *
   * The `View Full Schedule` button is omitted when `scheduleUrl` is empty
   * — Slack rejects buttons with empty URLs (`invalid_blocks`).
   */
  buildBroadcastDMBlocks(recipient: BroadcastRecipient, scheduleUrl: string): any[] {
    const lines = recipient.shifts.map((s) => `• ${s.startDate} → ${s.endDate}`).join('\n');

    const elements: any[] = [];
    if (scheduleUrl) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: ':spiral_calendar_pad: View Full Schedule', emoji: true },
        url: scheduleUrl,
        action_id: 'broadcast_view_schedule',
      });
    }
    elements.push(
      {
        type: 'button',
        text: { type: 'plain_text', text: ':arrows_counterclockwise: Request Replacement', emoji: true },
        action_id: 'broadcast_request_replacement',
        value: JSON.stringify({ kind: 'broadcast_request_replacement' }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':handshake: Request Swap', emoji: true },
        action_id: 'broadcast_request_swap',
        value: JSON.stringify({ kind: 'broadcast_request_swap' }),
      },
    );

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ":spiral_calendar_pad: *Here's your updated on-call schedule — please make sure to remember.*",
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines },
      },
      {
        type: 'actions',
        elements,
      },
    ];
  }

  /**
   * Ephemeral preview blocks for `/oncall broadcast`. Lists who would be
   * DM'd, who would be skipped (and why), and renders Send/Cancel buttons
   * when the invoker is on the admin allowlist.
   *
   * Non-admins see the same recipient/skip info plus a notice explaining
   * that only admins can fire the broadcast.
   */
  buildBroadcastPreviewBlocks(plan: BroadcastPlan, isAdmin: boolean): any[] {
    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Broadcast preview', emoji: true },
      },
    ];

    if (plan.recipients.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No one has upcoming shifts — nothing to broadcast._' },
      });
      if (plan.skipped.length > 0) {
        blocks.push(this.buildSkippedSection(plan));
      }
      return blocks;
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Will DM *${plan.recipients.length}* ${plan.recipients.length === 1 ? 'person' : 'people'}:`,
      },
    });

    for (const r of plan.recipients) {
      const shiftLines = r.shifts.map((s) => `  • ${s.startDate} → ${s.endDate}`).join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${r.personName}* (<@${r.slackUserId}>)\n${shiftLines}`,
        },
      });
    }

    if (plan.skipped.length > 0) {
      blocks.push(this.buildSkippedSection(plan));
    }

    if (isAdmin) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Send', emoji: true },
            style: 'primary',
            action_id: 'broadcast_send',
            value: JSON.stringify({ kind: 'broadcast_send' }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Cancel', emoji: true },
            action_id: 'broadcast_cancel',
            value: JSON.stringify({ kind: 'broadcast_cancel' }),
          },
        ],
      });
    } else {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Only on-call admins can send broadcasts. Ask one of them to run this if it looks right._',
          },
        ],
      });
    }

    return blocks;
  }

  private buildSkippedSection(plan: BroadcastPlan): any {
    const reasonLabel = (reason: string): string => {
      switch (reason) {
        case 'no_slack_mapping':
          return 'no Slack mapping';
        default:
          return reason;
      }
    };
    const lines = plan.skipped
      .map((s) => `  • ${s.personName} (${s.personEmail}) — ${reasonLabel(s.reason)}`)
      .join('\n');
    return {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Skipped:*\n${lines}` },
    };
  }

  /**
   * Modal that lets a user pick which of their upcoming shifts they want a
   * replacement for. Used by the `/oncall replacement` slash command and by
   * the "Request Replacement" button on broadcast DMs.
   */
  buildReplacementPickerModal(shifts: Shift[], email: string): any {
    return this.buildShiftPickerModal({
      callbackId: 'replacement_select_shift',
      title: 'Find Replacement',
      submit: 'Request Replacement',
      label: 'Which shift do you need covered?',
      shifts,
      email,
    });
  }

  /**
   * Modal that lets a user pick which of their upcoming shifts they want to
   * swap. Used by the `/oncall swap` slash command and by the "Request Swap"
   * button on broadcast DMs.
   */
  buildSwapPickerModal(shifts: Shift[], email: string): any {
    return this.buildShiftPickerModal({
      callbackId: 'swap_select_shift',
      title: 'Swap Shift',
      submit: 'Request Swap',
      label: 'Which shift do you want to swap?',
      shifts,
      email,
    });
  }

  private buildShiftPickerModal(opts: {
    callbackId: string;
    title: string;
    submit: string;
    label: string;
    shifts: Shift[];
    email: string;
  }): any {
    const shiftOptions = opts.shifts.map((s) => ({
      text: { type: 'plain_text' as const, text: `${s.startDate} → ${s.endDate} (${s.shiftType})` },
      value: JSON.stringify({
        shiftId: s.id,
        personId: s.personNotionId,
        startDate: s.startDate,
        endDate: s.endDate,
      }),
    }));

    return {
      type: 'modal',
      callback_id: opts.callbackId,
      title: { type: 'plain_text', text: opts.title },
      submit: { type: 'plain_text', text: opts.submit },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ email: opts.email }),
      blocks: [
        {
          type: 'input',
          block_id: 'shift_select_block',
          label: { type: 'plain_text', text: opts.label },
          element: {
            type: 'static_select',
            action_id: 'shift_select',
            options: shiftOptions,
            ...(shiftOptions.length === 1 && { initial_option: shiftOptions[0] }),
          },
        },
      ],
    };
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
