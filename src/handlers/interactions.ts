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
    const value = JSON.parse(action.value);

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
    }
  }

  async handleViewSubmission(payload: any): Promise<void> {
    const callbackId = payload.view?.callback_id;

    switch (callbackId) {
      case 'add_constraint':
        await this.handleAddConstraint(payload);
        break;
    }
  }

  private async handleSwitchAccept(payload: any, value: any): Promise<void> {
    const volunteerSlackId = payload.user.id;

    await this.notion.swapShiftPersons(
      value.shiftAId,
      value.personAId,
      value.shiftBId,
      value.personBId,
    );

    const requesterMention = await this.userMapping.getSlackMention(value.requesterEmail);
    const volunteerMention = `<@${volunteerSlackId}>`;

    await this.slack.postToChannel(
      `${volunteerMention} has agreed to cover ${requesterMention}'s shift (${value.startDate} → ${value.endDate}). Swap complete!`,
    );
  }

  private async handleSwitchApprove(payload: any, value: any): Promise<void> {
    await this.notion.swapShiftPersons(
      value.shiftAId,
      value.personAId,
      value.shiftBId,
      value.personBId,
    );

    const requesterSlackId = await this.userMapping.getSlackUserId(value.requesterEmail);
    const targetSlackId = await this.userMapping.getSlackUserId(value.targetEmail);

    if (requesterSlackId) {
      await this.slack.sendDM(
        requesterSlackId,
        `Your shift swap request has been approved! Shifts have been updated.`,
      );
    }

    if (targetSlackId) {
      await this.slack.sendDM(
        targetSlackId,
        `You approved the shift swap. Shifts have been updated.`,
      );
    }
  }

  private async handleSwitchDecline(payload: any, value: any): Promise<void> {
    const requesterSlackId = await this.userMapping.getSlackUserId(value.requesterEmail);

    if (requesterSlackId) {
      await this.slack.sendDM(
        requesterSlackId,
        `Your shift swap request was declined by ${value.targetName}.`,
      );
    }
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
