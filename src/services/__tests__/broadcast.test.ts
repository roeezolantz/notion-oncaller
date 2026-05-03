import { BroadcastService } from '../broadcast';
import { NotionService } from '../notion';
import { UserMappingService } from '../userMapping';
import { Shift } from '../../types';

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    name: 'Shift 1',
    personNotionId: 'person-1',
    personEmail: 'alice@example.com',
    personName: 'Alice',
    startDate: '2026-05-04',
    endDate: '2026-05-11',
    shiftType: 'Regular',
    status: 'Scheduled',
    ...overrides,
  };
}

function buildService(opts: { upcoming: Shift[]; slackIdByEmail: Record<string, string | null> }): BroadcastService {
  const notion = {
    getUpcomingShifts: jest.fn().mockResolvedValue(opts.upcoming),
  } as unknown as NotionService;

  const userMapping = {
    getSlackUserId: jest.fn(async (email: string) => opts.slackIdByEmail[email] ?? null),
  } as unknown as UserMappingService;

  return new BroadcastService(notion, userMapping);
}

describe('BroadcastService', () => {
  it('groups shifts by person and resolves Slack IDs for recipients', async () => {
    const aliceShift = shift({ id: 's1', personEmail: 'alice@example.com', personName: 'Alice' });
    const bobShift = shift({
      id: 's2',
      personEmail: 'bob@example.com',
      personName: 'Bob',
      personNotionId: 'person-2',
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });

    const service = buildService({
      upcoming: [aliceShift, bobShift],
      slackIdByEmail: {
        'alice@example.com': 'U_ALICE',
        'bob@example.com': 'U_BOB',
      },
    });

    const plan = await service.buildPlan();

    expect(plan.recipients).toHaveLength(2);
    expect(plan.recipients[0]).toMatchObject({
      slackUserId: 'U_ALICE',
      personEmail: 'alice@example.com',
      personName: 'Alice',
      shifts: [aliceShift],
    });
    expect(plan.recipients[1]).toMatchObject({
      slackUserId: 'U_BOB',
      personEmail: 'bob@example.com',
      personName: 'Bob',
      shifts: [bobShift],
    });
    expect(plan.skipped).toEqual([]);
  });

  it('collects multiple shifts for the same person, sorted by start date ascending', async () => {
    const later = shift({ id: 's2', startDate: '2026-07-01', endDate: '2026-07-08' });
    const earlier = shift({ id: 's1', startDate: '2026-05-04', endDate: '2026-05-11' });

    const service = buildService({
      upcoming: [later, earlier],
      slackIdByEmail: { 'alice@example.com': 'U_ALICE' },
    });

    const plan = await service.buildPlan();

    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0].shifts.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('skips people with no Slack mapping and records the reason', async () => {
    const aliceShift = shift({ personEmail: 'alice@example.com', personName: 'Alice' });
    const ghostShift = shift({
      id: 's3',
      personEmail: 'ghost@example.com',
      personName: 'Ghost',
      personNotionId: 'person-3',
    });

    const service = buildService({
      upcoming: [aliceShift, ghostShift],
      slackIdByEmail: {
        'alice@example.com': 'U_ALICE',
        'ghost@example.com': null,
      },
    });

    const plan = await service.buildPlan();

    expect(plan.recipients.map((r) => r.personEmail)).toEqual(['alice@example.com']);
    expect(plan.skipped).toEqual([
      { personEmail: 'ghost@example.com', personName: 'Ghost', reason: 'no_slack_mapping' },
    ]);
  });

  it('returns empty recipients and skipped lists when nobody has upcoming shifts', async () => {
    const service = buildService({ upcoming: [], slackIdByEmail: {} });

    const plan = await service.buildPlan();

    expect(plan.recipients).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('does not call userMapping more than once per unique email', async () => {
    const s1 = shift({ id: 's1', startDate: '2026-05-04', endDate: '2026-05-11' });
    const s2 = shift({ id: 's2', startDate: '2026-07-01', endDate: '2026-07-08' });

    const lookup = jest.fn(async () => 'U_ALICE');
    const notion = { getUpcomingShifts: jest.fn().mockResolvedValue([s1, s2]) } as unknown as NotionService;
    const userMapping = { getSlackUserId: lookup } as unknown as UserMappingService;

    const service = new BroadcastService(notion, userMapping);
    await service.buildPlan();

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('alice@example.com');
  });
});
