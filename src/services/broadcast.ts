import { NotionService } from './notion';
import { UserMappingService } from './userMapping';
import { Shift } from '../types';

export interface BroadcastRecipient {
  slackUserId: string;
  personNotionId: string;
  personEmail: string;
  personName: string;
  shifts: Shift[];
}

export type BroadcastSkipReason = 'no_slack_mapping';

export interface BroadcastSkipped {
  personEmail: string;
  personName: string;
  reason: BroadcastSkipReason;
}

export interface BroadcastPlan {
  recipients: BroadcastRecipient[];
  skipped: BroadcastSkipped[];
}

/**
 * Builds a per-person plan describing who would receive an upcoming-shifts
 * broadcast DM and who would be skipped (and why).
 *
 * Pure data layer — no Slack I/O. Callers render the plan and send the DMs.
 */
export class BroadcastService {
  constructor(
    private notion: NotionService,
    private userMapping: UserMappingService,
  ) {}

  async buildPlan(): Promise<BroadcastPlan> {
    const upcoming = await this.notion.getUpcomingShifts();

    const grouped = new Map<string, { personName: string; personNotionId: string; shifts: Shift[] }>();
    for (const s of upcoming) {
      const existing = grouped.get(s.personEmail);
      if (existing) {
        existing.shifts.push(s);
      } else {
        grouped.set(s.personEmail, {
          personName: s.personName,
          personNotionId: s.personNotionId,
          shifts: [s],
        });
      }
    }

    const recipients: BroadcastRecipient[] = [];
    const skipped: BroadcastSkipped[] = [];

    for (const [personEmail, info] of grouped) {
      const slackUserId = await this.userMapping.getSlackUserId(personEmail);
      if (!slackUserId) {
        skipped.push({ personEmail, personName: info.personName, reason: 'no_slack_mapping' });
        continue;
      }

      const shifts = [...info.shifts].sort((a, b) => a.startDate.localeCompare(b.startDate));

      recipients.push({
        slackUserId,
        personNotionId: info.personNotionId,
        personEmail,
        personName: info.personName,
        shifts,
      });
    }

    return { recipients, skipped };
  }
}
