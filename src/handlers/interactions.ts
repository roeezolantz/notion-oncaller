import { NotionService } from '../services/notion';
import { SlackService } from '../services/slack';
import { UserMappingService } from '../services/userMapping';

export class InteractionHandler {
  constructor(
    private notion: NotionService,
    private slack: SlackService,
    private userMapping: UserMappingService,
  ) {}

  async handleBlockAction(payload: any): Promise<void> {
    const action = payload.actions?.[0];
    if (!action) return;

    const actionId = action.action_id;

    // Skip URL buttons (view_schedule etc.) — they have no value to parse
    if (!action.value || actionId.startsWith('view_')) return;

    let value: any;
    try {
      value = JSON.parse(action.value);
    } catch {
      console.error('Failed to parse action value:', action.value);
      return;
    }

    switch (actionId) {
      // Replacement flow
      case 'replacement_accept':
        await this.handleReplacementAccept(payload, value);
        break;
      case 'replacement_cancel':
        await this.handleReplacementCancel(payload);
        break;

      // Swap flow
      case 'swap_propose':
        await this.handleSwapPropose(payload, value);
        break;
      case 'swap_accept':
        await this.handleSwapAccept(payload, value);
        break;
      case 'swap_decline_proposal':
        await this.handleSwapDeclineProposal(payload, value);
        break;
      case 'swap_cancel':
        await this.handleSwapCancel(payload);
        break;

      // Legacy: reminder button uses replacement flow
      case 'switch_request_from_reminder':
        await this.handleSwitchFromReminder(payload, value);
        break;
    }
  }

  async handleViewSubmission(payload: any): Promise<void> {
    const callbackId = payload.view?.callback_id;

    switch (callbackId) {
      case 'add_constraint':
        await this.handleAddConstraint(payload);
        break;
      case 'replacement_select_shift':
        await this.handleReplacementSelectShift(payload);
        break;
      case 'swap_select_shift':
        await this.handleSwapSelectShift(payload);
        break;
      case 'swap_propose_shift':
        await this.handleSwapProposeShift(payload);
        break;
    }
  }

  // --- Replacement flow ---

  private async handleReplacementSelectShift(payload: any): Promise<void> {
    const values = payload.view.state.values;
    const metadata = JSON.parse(payload.view.private_metadata || '{}');
    const email = metadata.email;

    const shiftData = JSON.parse(values.shift_select_block.shift_select.selected_option.value);

    const shifts = await this.notion.getShiftsForPerson(email);
    const shift = shifts.find((s: any) => s.id === shiftData.shiftId);
    const personName = shift?.personName || '';

    const requestData = JSON.stringify({
      shiftId: shiftData.shiftId,
      personId: shiftData.personId,
      requesterEmail: email,
      startDate: shiftData.startDate,
      endDate: shiftData.endDate,
    });

    const mention = await this.userMapping.getSlackMention(email);
    const blocks = this.slack.buildReplacementRequestBlocks(personName, shift || shiftData as any, requestData);
    await this.slack.postToChannel(`${mention} needs someone to cover ${shiftData.startDate} → ${shiftData.endDate}`, blocks);
  }

  private async handleReplacementAccept(payload: any, value: any): Promise<void> {
    const volunteerSlackId = payload.user.id;
    const volunteerEmail = await this.userMapping.getEmailBySlackId(volunteerSlackId);

    if (!volunteerEmail) {
      await this.slack.sendDM(volunteerSlackId, 'Could not find your Notion account. Cannot complete the replacement.');
      return;
    }

    // Find volunteer's Notion person ID from their shifts
    const volunteerShifts = await this.notion.getShiftsForPerson(volunteerEmail);
    if (volunteerShifts.length === 0) {
      await this.slack.sendDM(volunteerSlackId, 'Could not find your Notion person record. Cannot complete the replacement.');
      return;
    }
    const volunteerPersonNotionId = volunteerShifts[0].personNotionId;

    // Reassign the shift to the volunteer
    await this.notion.reassignShift(value.shiftId, volunteerPersonNotionId);

    const requesterMention = await this.userMapping.getSlackMention(value.requesterEmail);
    const volunteerMention = `<@${volunteerSlackId}>`;

    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    const doneText = `✅ ${volunteerMention} is covering ${value.startDate} → ${value.endDate} (was ${requesterMention})`;
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, doneText, []);
    }
  }

  private async handleReplacementCancel(payload: any): Promise<void> {
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    const cancellerMention = `<@${payload.user.id}>`;

    if (channelId && messageTs) {
      await this.slack.updateMessage(
        channelId,
        messageTs,
        `🚫 Replacement request cancelled by ${cancellerMention}.`,
        [],
      );
    }
  }

  // --- Swap flow ---

  private async handleSwapSelectShift(payload: any): Promise<void> {
    const values = payload.view.state.values;
    const metadata = JSON.parse(payload.view.private_metadata || '{}');
    const email = metadata.email;

    const shiftData = JSON.parse(values.shift_select_block.shift_select.selected_option.value);

    const shifts = await this.notion.getShiftsForPerson(email);
    const shift = shifts.find((s: any) => s.id === shiftData.shiftId);
    const personName = shift?.personName || '';

    const requestData = JSON.stringify({
      requesterShiftId: shiftData.shiftId,
      requesterPersonId: shiftData.personId,
      requesterEmail: email,
      startDate: shiftData.startDate,
      endDate: shiftData.endDate,
    });

    const mention = await this.userMapping.getSlackMention(email);
    const blocks = this.slack.buildSwapRequestBlocks(personName, shift || shiftData as any, requestData);
    await this.slack.postToChannel(`${mention} wants to swap their ${shiftData.startDate} → ${shiftData.endDate} shift`, blocks);
  }

  private async handleSwapPropose(payload: any, value: any): Promise<void> {
    const proposerSlackId = payload.user.id;
    const proposerEmail = await this.userMapping.getEmailBySlackId(proposerSlackId);

    if (!proposerEmail) {
      await this.slack.sendDM(proposerSlackId, 'Could not find your Notion account.');
      return;
    }

    const proposerShifts = await this.notion.getShiftsForPerson(proposerEmail);
    const upcoming = proposerShifts.filter((s: any) => s.status === 'Scheduled');

    if (upcoming.length === 0) {
      await this.slack.sendDM(proposerSlackId, 'You have no upcoming shifts to propose.');
      return;
    }

    const shiftOptions = upcoming.map((s: any) => ({
      text: { type: 'plain_text' as const, text: `${s.startDate} → ${s.endDate} (${s.shiftType})` },
      value: JSON.stringify({ shiftId: s.id, personId: s.personNotionId, startDate: s.startDate, endDate: s.endDate }),
    }));

    const channelId = payload.channel?.id || '';
    const messageTs = payload.message?.ts || '';

    const modal: any = {
      type: 'modal',
      callback_id: 'swap_propose_shift',
      title: { type: 'plain_text', text: 'Propose Swap' },
      submit: { type: 'plain_text', text: 'Propose' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({
        requesterShiftId: value.requesterShiftId,
        requesterPersonId: value.requesterPersonId,
        requesterEmail: value.requesterEmail,
        requesterStartDate: value.startDate,
        requesterEndDate: value.endDate,
        channelId,
        messageTs,
      }),
      blocks: [
        {
          type: 'input',
          block_id: 'shift_select_block',
          label: { type: 'plain_text', text: 'Which shift do you want to offer?' },
          element: {
            type: 'static_select',
            action_id: 'shift_select',
            options: shiftOptions,
            ...(shiftOptions.length === 1 && { initial_option: shiftOptions[0] }),
          },
        },
      ],
    };

    await this.slack.openModal(payload.trigger_id, modal);
  }

  private async handleSwapProposeShift(payload: any): Promise<void> {
    const values = payload.view.state.values;
    const metadata = JSON.parse(payload.view.private_metadata || '{}');

    const proposerShiftData = JSON.parse(values.shift_select_block.shift_select.selected_option.value);
    const proposerSlackId = payload.user.id;
    const proposerEmail = await this.userMapping.getEmailBySlackId(proposerSlackId);

    // Get proposer's name
    const proposerShifts = await this.notion.getShiftsForPerson(proposerEmail!);
    const proposerShift = proposerShifts.find((s: any) => s.id === proposerShiftData.shiftId);
    const proposerName = proposerShift?.personName || '';

    // Get requester's Slack ID
    const requesterSlackId = await this.userMapping.getSlackUserId(metadata.requesterEmail);

    const acceptData = JSON.stringify({
      requesterShiftId: metadata.requesterShiftId,
      requesterPersonId: metadata.requesterPersonId,
      requesterEmail: metadata.requesterEmail,
      requesterStartDate: metadata.requesterStartDate,
      requesterEndDate: metadata.requesterEndDate,
      proposerShiftId: proposerShiftData.shiftId,
      proposerPersonId: proposerShiftData.personId,
      proposerEmail: proposerEmail,
      proposerStartDate: proposerShiftData.startDate,
      proposerEndDate: proposerShiftData.endDate,
      channelId: metadata.channelId,
      messageTs: metadata.messageTs,
    });

    // DM the requester with the proposal
    if (requesterSlackId) {
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 Swap proposal for your ${metadata.requesterStartDate} → ${metadata.requesterEndDate} shift:\n• ${proposerName} offers ${proposerShiftData.startDate} → ${proposerShiftData.endDate}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Accept', emoji: true },
              style: 'primary',
              action_id: 'swap_accept',
              value: acceptData,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Decline', emoji: true },
              style: 'danger',
              action_id: 'swap_decline_proposal',
              value: acceptData,
            },
          ],
        },
      ];

      const requesterMention = await this.userMapping.getSlackMention(metadata.requesterEmail);
      await this.slack.sendDM(
        requesterSlackId,
        `Swap proposal from ${proposerName}`,
        blocks,
      );
    }

    // DM the proposer confirmation
    const requesterShifts = await this.notion.getShiftsForPerson(metadata.requesterEmail);
    const requesterShift = requesterShifts.find((s: any) => s.id === metadata.requesterShiftId);
    const requesterName = requesterShift?.personName || '';

    await this.slack.sendDM(
      proposerSlackId,
      `Your proposal was sent to ${requesterName}. Waiting for their response.`,
    );
  }

  private async handleSwapAccept(payload: any, value: any): Promise<void> {
    // Swap both shifts
    await this.notion.swapShiftPersons(
      value.requesterShiftId,
      value.requesterPersonId,
      value.proposerShiftId,
      value.proposerPersonId,
    );

    // Update the DM (where the accept button was clicked)
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    const proposerMention = await this.userMapping.getSlackMention(value.proposerEmail);
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, `✅ Swap complete! You ↔ ${proposerMention}`, []);
    }

    // Update the original channel message
    const requesterMention = await this.userMapping.getSlackMention(value.requesterEmail);
    if (value.channelId && value.messageTs) {
      await this.slack.updateMessage(
        value.channelId,
        value.messageTs,
        `✅ Swapped! ${requesterMention} ↔ ${proposerMention} (${value.requesterStartDate} → ${value.requesterEndDate} / ${value.proposerStartDate} → ${value.proposerEndDate})`,
        [],
      );
    }

    // DM the proposer
    const proposerSlackId = await this.userMapping.getSlackUserId(value.proposerEmail);
    if (proposerSlackId) {
      await this.slack.sendDM(proposerSlackId, '✅ Your swap proposal was accepted!');
    }
  }

  private async handleSwapDeclineProposal(payload: any, value: any): Promise<void> {
    // Update the DM to remove buttons
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, '❌ Proposal declined', []);
    }

    // DM the proposer
    const proposerSlackId = await this.userMapping.getSlackUserId(value.proposerEmail);
    if (proposerSlackId) {
      await this.slack.sendDM(proposerSlackId, 'Your swap proposal was declined.');
    }
  }

  private async handleSwapCancel(payload: any): Promise<void> {
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, '🚫 Swap request cancelled', []);
    }
  }

  // --- Legacy: reminder button uses replacement flow ---

  private async handleSwitchFromReminder(payload: any, value: any): Promise<void> {
    const userSlackId = payload.user.id;
    const email = await this.userMapping.getEmailBySlackId(userSlackId);
    if (!email) return;

    const shifts = await this.notion.getShiftsForPerson(email);
    const shift = shifts.find((s: any) => s.id === value.shiftId);
    if (!shift) {
      await this.slack.sendDM(userSlackId, 'Could not find that shift.');
      return;
    }

    const mention = await this.userMapping.getSlackMention(email);
    const requestData = JSON.stringify({
      shiftId: shift.id,
      personId: shift.personNotionId,
      requesterEmail: email,
      startDate: shift.startDate,
      endDate: shift.endDate,
    });

    const blocks = this.slack.buildReplacementRequestBlocks(shift.personName, shift, requestData);
    await this.slack.postToChannel(`${mention} needs someone to cover their shift`, blocks);
    await this.slack.sendDM(userSlackId, ':white_check_mark: Replacement request posted to the channel.');
  }

  // --- Constraints ---

  private async handleAddConstraint(payload: any): Promise<void> {
    const values = payload.view.state.values;
    console.log('Modal values:', JSON.stringify(values));

    const startDate = values.start_date_block?.start_date?.selected_date;
    const endDate = values.end_date_block?.end_date?.selected_date;
    const reason = values.reason_block?.reason?.value || '';

    if (!startDate || !endDate) {
      console.error('Missing dates in modal submission');
      return;
    }

    const userSlackId = payload.user.id;
    const userEmail = await this.userMapping.getEmailBySlackId(userSlackId);
    if (!userEmail) {
      await this.slack.sendDM(userSlackId, 'Could not find your Notion account. Make sure your Slack and Notion emails match.');
      return;
    }

    const userName = payload.user.name || payload.user.username || userEmail;

    // Look up Notion user ID from email
    const notionUsers = await this.notion.getShiftsForPerson(userEmail);
    const notionPersonId = notionUsers.length > 0 ? notionUsers[0].personNotionId : '';

    // Check for overlapping shifts
    const overlapping = await this.notion.getOverlappingShifts(userEmail, startDate, endDate);

    if (overlapping.length > 0) {
      const shiftDates = overlapping
        .map((s) => `${s.startDate} → ${s.endDate}`)
        .join(', ');

      await this.slack.sendDM(
        userSlackId,
        `:warning: You have ${overlapping.length} shift(s) overlapping with your blocked dates (${shiftDates}). The block was still created — please arrange coverage.`,
      );
    }

    await this.notion.createConstraint(
      notionPersonId,
      userName,
      startDate,
      endDate,
      reason,
    );

    await this.slack.sendDM(
      userSlackId,
      `:white_check_mark: Blocked dates recorded: ${startDate} → ${endDate}${reason ? ` (${reason})` : ''}`,
    );
  }
}
