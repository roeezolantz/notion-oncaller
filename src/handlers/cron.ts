import dayjs from 'dayjs';
import { NotionService } from '../services/notion';
import { SlackService } from '../services/slack';
import { UserMappingService } from '../services/userMapping';
import { config } from '../config';
import { sleep } from '../utils';

export class CronHandler {
  constructor(
    private notion: NotionService,
    private slack: SlackService,
    private userMapping: UserMappingService,
  ) {}

  async handleDaily(): Promise<void> {
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const inSevenDays = dayjs().add(7, 'day').format('YYYY-MM-DD');

    // Always sync @oncall group with current active shift in Notion
    try {
      await this.syncOncallGroup();
    } catch (err) {
      console.error('Oncall group sync error:', err);
    }

    await sleep(500);

    try {
      await this.handleShiftChange(today);
    } catch (err) {
      console.error('Shift change error:', err);
    }

    await sleep(500);

    try {
      await this.handleReminder(tomorrow, '1 day');
    } catch (err) {
      console.error('1-day reminder error:', err);
    }

    await sleep(500);

    try {
      await this.handleReminder(inSevenDays, '7 days');
    } catch (err) {
      console.error('7-day reminder error:', err);
    }
  }

  private async handleShiftChange(today: string): Promise<void> {
    const newShifts = await this.notion.getShiftsByDate(today);
    if (newShifts.length === 0) return;

    await sleep(400);
    const activeShift = await this.notion.getActiveShift();
    if (activeShift) {
      await sleep(400);
      await this.notion.updateShiftStatus(activeShift.id, 'Completed');
    }

    for (const shift of newShifts) {
      await sleep(400);
      await this.notion.updateShiftStatus(shift.id, 'Active');
      const slackUserId = await this.userMapping.getSlackUserId(shift.personEmail);
      if (slackUserId) {
        await this.slack.updateOncallGroup(slackUserId);
      }
      const mention = await this.userMapping.getSlackMention(shift.personEmail);
      const text = `:telephone_receiver: *On-call update* — ${mention} is now on-call until ${shift.endDate}`;
      const blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: ':spiral_calendar_pad: View Full Schedule' },
              url: config.notion.scheduleUrl,
              action_id: 'view_schedule',
            },
          ],
        },
      ];
      await this.slack.postToChannel(text, blocks);
    }
  }

  private async syncOncallGroup(): Promise<void> {
    const activeShift = await this.notion.getActiveShift();
    if (!activeShift) {
      console.log('No active shift found — skipping @oncall sync');
      return;
    }

    const slackUserId = await this.userMapping.getSlackUserId(activeShift.personEmail);
    if (!slackUserId) {
      console.log(`Could not find Slack user for ${activeShift.personEmail} — skipping @oncall sync`);
      return;
    }

    console.log(`Syncing @oncall group to ${activeShift.personName} (${slackUserId})`);
    await this.slack.updateOncallGroup(slackUserId);
  }

  private async handleReminder(date: string, label: string): Promise<void> {
    const shifts = await this.notion.getShiftsByDate(date);
    for (const shift of shifts) {
      const slackUserId = await this.userMapping.getSlackUserId(shift.personEmail);
      if (!slackUserId) continue;
      const emoji = label === '1 day' ? ':bell:' : ':calendar_spiral:';
      const text = `${emoji} *Reminder:* Your on-call shift starts in ${label} (${shift.startDate} → ${shift.endDate}).`;
      const blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: ':arrows_counterclockwise: Request Switch' },
              style: 'primary' as const,
              action_id: 'switch_request_from_reminder',
              value: JSON.stringify({ shiftId: shift.id, personId: shift.personNotionId }),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: ':spiral_calendar_pad: View Schedule' },
              url: config.notion.scheduleUrl,
              action_id: 'view_schedule_reminder',
            },
          ],
        },
      ];
      await this.slack.sendDM(slackUserId, text, blocks);
    }
  }
}
