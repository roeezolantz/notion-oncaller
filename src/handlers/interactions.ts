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
      case 'switch_accept':
        await this.handleSwitchAccept(payload, value);
        break;
      case 'switch_approve':
        await this.handleSwitchApprove(payload, value);
        break;
      case 'switch_decline':
        await this.handleSwitchDecline(payload, value);
        break;
      case 'switch_cancel':
        await this.handleSwitchCancel(payload, value);
        break;
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
      case 'switch_select_shift':
        await this.handleSwitchSelectShift(payload);
        break;
    }
  }

  private async handleSwitchAccept(payload: any, value: any): Promise<void> {
    const volunteerSlackId = payload.user.id;
    const volunteerEmail = await this.userMapping.getEmailBySlackId(volunteerSlackId);

    if (!volunteerEmail) {
      await this.slack.sendDM(volunteerSlackId, 'Could not find your Notion account. Cannot complete the swap.');
      return;
    }

    // Find volunteer's next upcoming shift
    const volunteerShifts = await this.notion.getShiftsForPerson(volunteerEmail);
    const volunteerUpcoming = volunteerShifts.filter((s) => s.status === 'Scheduled');

    if (volunteerUpcoming.length === 0) {
      await this.slack.sendDM(volunteerSlackId, 'You have no upcoming shifts to swap. Cannot complete the swap.');
      return;
    }

    const volunteerShift = volunteerUpcoming[0];

    await this.notion.swapShiftPersons(
      value.shiftAId,
      value.personAId,
      volunteerShift.id,
      volunteerShift.personNotionId,
    );

    const requesterMention = await this.userMapping.getSlackMention(value.requesterEmail);
    const volunteerMention = `<@${volunteerSlackId}>`;

    // Update the original message — no second message needed
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    const doneText = `:white_check_mark: *Swap complete* — ${volunteerMention} is covering ${requesterMention}'s shift (${value.startDate} → ${value.endDate})`;
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, doneText, []);
    }
  }

  private async handleSwitchApprove(payload: any, value: any): Promise<void> {
    await this.notion.swapShiftPersons(
      value.shiftAId,
      value.personAId,
      value.shiftBId,
      value.personBId,
    );

    // Update the DM to remove buttons
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, ':white_check_mark: *Swap approved!* Shifts updated.', []);
    }

    const requesterSlackId = await this.userMapping.getSlackUserId(value.requesterEmail);
    const targetSlackId = await this.userMapping.getSlackUserId(value.targetEmail);

    if (requesterSlackId) {
      await this.slack.sendDM(requesterSlackId, `:white_check_mark: Your shift swap was approved! Shifts updated.`);
    }
    if (targetSlackId) {
      await this.slack.sendDM(targetSlackId, `:white_check_mark: You approved the shift swap. Shifts updated.`);
    }
  }

  private async handleSwitchDecline(payload: any, value: any): Promise<void> {
    // Update the DM to remove buttons
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    if (channelId && messageTs) {
      await this.slack.updateMessage(channelId, messageTs, ':x: *Swap declined.*', []);
    }

    const requesterSlackId = await this.userMapping.getSlackUserId(value.requesterEmail);

    if (requesterSlackId) {
      await this.slack.sendDM(
        requesterSlackId,
        `Your shift swap request was declined by ${value.targetName}.`,
      );
    }
  }

  private async handleSwitchSelectShift(payload: any): Promise<void> {
    const values = payload.view.state.values;
    const metadata = JSON.parse(payload.view.private_metadata || '{}');
    const email = metadata.email;
    let targetSlackId = metadata.targetSlackId;

    const shiftData = JSON.parse(values.shift_select_block.shift_select.selected_option.value);
    const userSlackId = payload.user.id;

    // Check if user picked a target from the modal
    if (!targetSlackId && values.switch_target_block?.switch_target?.selected_user) {
      targetSlackId = values.switch_target_block.switch_target.selected_user;
    }

    const mention = await this.userMapping.getSlackMention(email);

    if (targetSlackId) {
      // Direct switch
      const targetEmail = await this.userMapping.getEmailBySlackId(targetSlackId);
      if (!targetEmail) {
        await this.slack.sendDM(userSlackId, `Could not find that user's Notion account.`);
        return;
      }

      const targetShifts = await this.notion.getShiftsForPerson(targetEmail);
      const targetUpcoming = targetShifts.filter((s) => s.status === 'Scheduled');
      if (targetUpcoming.length === 0) {
        await this.slack.sendDM(userSlackId, `That person has no upcoming shifts to swap with.`);
        return;
      }

      const targetShift = targetUpcoming[0];
      const personName = (await this.notion.getShiftsForPerson(email)).find(s => s.id === shiftData.shiftId)?.personName || '';

      const requestData = JSON.stringify({
        shiftAId: shiftData.shiftId,
        personAId: shiftData.personId,
        shiftBId: targetShift.id,
        personBId: targetShift.personNotionId,
        requesterEmail: email,
        targetEmail: targetEmail,
        targetName: targetShift.personName,
      });

      const blocks = this.slack.buildDirectSwitchBlocks(personName, shiftData as any, targetShift, requestData);
      await this.slack.sendDM(targetSlackId, `${personName} wants to swap shifts with you`, blocks);
      await this.slack.sendDM(userSlackId, `:arrows_counterclockwise: Switch request sent to <@${targetSlackId}>`);
    } else {
      // Broadcast
      const requestData = JSON.stringify({
        shiftAId: shiftData.shiftId,
        personAId: shiftData.personId,
        requesterEmail: email,
        startDate: shiftData.startDate,
        endDate: shiftData.endDate,
      });

      const shifts = await this.notion.getShiftsForPerson(email);
      const shift = shifts.find(s => s.id === shiftData.shiftId);
      const personName = shift?.personName || '';

      const blocks = this.slack.buildSwitchRequestBlocks(personName, shift || shiftData as any, requestData);
      await this.slack.postToChannel(`${mention} needs someone to cover their shift`, blocks);
      await this.slack.sendDM(userSlackId, ':arrows_counterclockwise: Switch request posted to the channel.');
    }
  }

  private async handleSwitchCancel(payload: any, value: any): Promise<void> {
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    const cancellerMention = `<@${payload.user.id}>`;

    if (channelId && messageTs) {
      await this.slack.updateMessage(
        channelId,
        messageTs,
        `:no_entry_sign: Switch request cancelled by ${cancellerMention}.`,
        [],
      );
    }
  }

  private async handleSwitchFromReminder(payload: any, value: any): Promise<void> {
    // User clicked "Request Switch" from a reminder DM — broadcast to channel
    const userSlackId = payload.user.id;
    const email = await this.userMapping.getEmailBySlackId(userSlackId);
    if (!email) return;

    const shifts = await this.notion.getShiftsForPerson(email);
    const shift = shifts.find((s) => s.id === value.shiftId);
    if (!shift) {
      await this.slack.sendDM(userSlackId, 'Could not find that shift.');
      return;
    }

    const mention = await this.userMapping.getSlackMention(email);
    const requestData = JSON.stringify({
      shiftAId: shift.id,
      personAId: shift.personNotionId,
      requesterEmail: email,
      startDate: shift.startDate,
      endDate: shift.endDate,
    });

    const blocks = this.slack.buildSwitchRequestBlocks(shift.personName, shift, requestData);
    await this.slack.postToChannel(`${mention} needs someone to cover their shift`, blocks);
    await this.slack.sendDM(userSlackId, ':white_check_mark: Switch request posted to the channel.');
  }

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
