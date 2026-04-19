import dayjs from 'dayjs';
import { NotionService } from '../services/notion';
import { SlackService } from '../services/slack';
import { UserMappingService } from '../services/userMapping';

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

    await this.handleShiftChange(today);
    await this.handleReminder(tomorrow, '1 day');
    await this.handleReminder(inSevenDays, '7 days');
  }

  private async handleShiftChange(today: string): Promise<void> {
    const newShifts = await this.notion.getShiftsByDate(today);
    if (newShifts.length === 0) return;

    const activeShift = await this.notion.getActiveShift();
    if (activeShift) {
      await this.notion.updateShiftStatus(activeShift.id, 'Completed');
    }

    for (const shift of newShifts) {
      await this.notion.updateShiftStatus(shift.id, 'Active');
      const slackUserId = await this.userMapping.getSlackUserId(shift.personEmail);
      if (slackUserId) {
        await this.slack.updateOncallGroup(slackUserId);
      }
      const mention = await this.userMapping.getSlackMention(shift.personEmail);
      const typeLabel = shift.shiftType === 'Holiday' ? ':palm_tree: Holiday' : ':calendar: Regular';
      await this.slack.postToChannel(
        `:rotating_light: *On-call shift change!* ${mention} is now on-call until ${shift.endDate} (${typeLabel})`
      );
    }
  }

  private async handleReminder(date: string, label: string): Promise<void> {
    const shifts = await this.notion.getShiftsByDate(date);
    for (const shift of shifts) {
      const slackUserId = await this.userMapping.getSlackUserId(shift.personEmail);
      if (!slackUserId) continue;
      const emoji = label === '1 day' ? ':bell:' : ':calendar_spiral:';
      await this.slack.sendDM(
        slackUserId,
        `${emoji} *Reminder:* Your on-call shift starts in ${label} (${shift.startDate} → ${shift.endDate}).`
      );
    }
  }
}
