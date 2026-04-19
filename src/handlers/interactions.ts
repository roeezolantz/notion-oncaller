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
    const startDate = values.start_date.start_date_pick.selected_date;
    const endDate = values.end_date.end_date_pick.selected_date;
    const reason = values.reason.reason_input.value || '';

    const userSlackId = payload.user.id;
    const userEmail = payload.user.email;
    const userName = payload.user.name;
    const userNotionId = payload.user.notionId;

    // Check for overlapping shifts
    const overlapping = await this.notion.getOverlappingShifts(userEmail, startDate, endDate);

    if (overlapping.length > 0) {
      const shiftDates = overlapping
        .map((s) => `${s.startDate} → ${s.endDate}`)
        .join(', ');

      await this.slack.sendDM(
        userSlackId,
        `Warning: You have ${overlapping.length} shift(s) overlapping with your constraint (${shiftDates}). The constraint was still created — please arrange coverage.`,
      );
    }

    await this.notion.createConstraint(
      userNotionId,
      userName,
      startDate,
      endDate,
      reason,
    );

    await this.slack.sendDM(
      userSlackId,
      `Your constraint from ${startDate} to ${endDate} has been recorded.`,
    );
  }
}
