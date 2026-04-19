# notion-oncaller Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Slack-integrated on-call management tool backed by Notion, deployed as a GCP Cloud Function.

**Architecture:** Single GCP Cloud Function (TypeScript) with two HTTP triggers — Slack interactions and a daily Cloud Scheduler cron. Notion is the sole data store. Slack is the sole UI.

**Tech Stack:** TypeScript, Node.js 20, @slack/bolt, @slack/web-api, @notionhq/client, @google-cloud/functions-framework, dayjs

**Design doc:** `docs/plans/2026-04-19-notion-oncaller-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/types/index.ts`

**Step 1: Initialize package.json**

```bash
cd /Users/roeezolantz/Development/fhenix/notion-oncaller
npm init -y
```

Then update `package.json`:

```json
{
  "name": "notion-oncaller",
  "version": "1.0.0",
  "description": "Slack-integrated on-call management tool backed by Notion",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "npx functions-framework --target=app --source=dist/",
    "dev": "tsc -w & npx functions-framework --target=app --source=dist/",
    "test": "jest",
    "test:watch": "jest --watch",
    "deploy": "bash deploy/deploy.sh",
    "lint": "eslint src/"
  },
  "keywords": ["notion", "slack", "oncall", "gcp", "cloud-function"],
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Install dependencies**

```bash
npm install @notionhq/client @slack/bolt @slack/web-api @google-cloud/functions-framework dayjs
npm install -D typescript @types/node jest ts-jest @types/jest eslint
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.js.map
coverage/
.DS_Store
```

**Step 5: Create .env.example**

```
# Notion
NOTION_API_KEY=secret_...
NOTION_ONCALL_DB_ID=3478471c7c228067a881e566217b2688
NOTION_CONSTRAINTS_DB_ID=

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_ONCALL_CHANNEL=C0123456789
SLACK_ONCALL_USERGROUP_ID=S0123456789

# App
CRON_SECRET=some-shared-secret
```

**Step 6: Create src/config.ts**

```typescript
export const config = {
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    oncallDbId: process.env.NOTION_ONCALL_DB_ID || '',
    constraintsDbId: process.env.NOTION_CONSTRAINTS_DB_ID || '',
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    signingSecret: process.env.SLACK_SIGNING_SECRET || '',
    oncallChannel: process.env.SLACK_ONCALL_CHANNEL || '',
    oncallUsergroupId: process.env.SLACK_ONCALL_USERGROUP_ID || '',
  },
  cron: {
    secret: process.env.CRON_SECRET || '',
  },
} as const;
```

**Step 7: Create src/types/index.ts**

```typescript
export interface Shift {
  id: string;
  name: string;
  personNotionId: string;
  personEmail: string;
  personName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  shiftType: 'Regular' | 'Backup Standby' | 'Backup Used' | 'Holiday';
  status: 'Scheduled' | 'Active' | 'Completed' | 'Cancelled';
}

export interface Constraint {
  id: string;
  personNotionId: string;
  personEmail: string;
  personName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Active' | 'Expired' | 'Cancelled';
}

export interface SlackUser {
  id: string;
  email: string;
  realName: string;
}
```

**Step 8: Create jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
};
```

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with deps, types, and config"
```

---

### Task 2: Notion Service — Query Shifts

**Files:**
- Create: `src/services/notion.ts`
- Create: `src/services/__tests__/notion.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/notion.test.ts
import { NotionService } from '../notion';

// Mock the Notion client
jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    databases: {
      query: jest.fn(),
    },
    pages: {
      update: jest.fn(),
    },
    users: {
      retrieve: jest.fn(),
    },
  })),
}));

describe('NotionService', () => {
  let service: NotionService;

  beforeEach(() => {
    service = new NotionService('fake-api-key', 'oncall-db-id', 'constraints-db-id');
  });

  describe('getShiftsByDate', () => {
    it('should query shifts starting on a specific date', async () => {
      const mockQuery = service['client'].databases.query as jest.Mock;
      mockQuery.mockResolvedValue({ results: [] });

      const result = await service.getShiftsByDate('2026-04-20');
      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          database_id: 'oncall-db-id',
        })
      );
    });
  });

  describe('getActiveShift', () => {
    it('should query for the currently active shift', async () => {
      const mockQuery = service['client'].databases.query as jest.Mock;
      mockQuery.mockResolvedValue({ results: [] });

      const result = await service.getActiveShift();
      expect(result).toBeNull();
    });
  });

  describe('getUpcomingShifts', () => {
    it('should return shifts with Scheduled status', async () => {
      const mockQuery = service['client'].databases.query as jest.Mock;
      mockQuery.mockResolvedValue({ results: [] });

      const result = await service.getUpcomingShifts();
      expect(result).toEqual([]);
    });
  });

  describe('updateShiftStatus', () => {
    it('should update a shift status in Notion', async () => {
      const mockUpdate = service['client'].pages.update as jest.Mock;
      mockUpdate.mockResolvedValue({});

      await service.updateShiftStatus('page-id', 'Active');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'page-id',
        })
      );
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/services/__tests__/notion.test.ts -v
```

Expected: FAIL — `NotionService` not found

**Step 3: Implement NotionService**

```typescript
// src/services/notion.ts
import { Client } from '@notionhq/client';
import dayjs from 'dayjs';
import { Shift, Constraint } from '../types';

export class NotionService {
  private client: Client;
  private oncallDbId: string;
  private constraintsDbId: string;

  constructor(apiKey: string, oncallDbId: string, constraintsDbId: string) {
    this.client = new Client({ auth: apiKey });
    this.oncallDbId = oncallDbId;
    this.constraintsDbId = constraintsDbId;
  }

  async getShiftsByDate(date: string): Promise<Shift[]> {
    const response = await this.client.databases.query({
      database_id: this.oncallDbId,
      filter: {
        property: 'Shift Dates',
        date: { equals: date },
      },
    });
    return response.results.map((page: any) => this.parseShift(page));
  }

  async getActiveShift(): Promise<Shift | null> {
    const response = await this.client.databases.query({
      database_id: this.oncallDbId,
      filter: {
        property: 'Status',
        status: { equals: 'Active' },
      },
    });
    if (response.results.length === 0) return null;
    return this.parseShift(response.results[0]);
  }

  async getUpcomingShifts(): Promise<Shift[]> {
    const response = await this.client.databases.query({
      database_id: this.oncallDbId,
      filter: {
        property: 'Status',
        status: { equals: 'Scheduled' },
      },
      sorts: [{ property: 'Shift Dates', direction: 'ascending' }],
    });
    return response.results.map((page: any) => this.parseShift(page));
  }

  async getShiftsForPerson(email: string): Promise<Shift[]> {
    // Get all non-completed shifts, filter by person email in code
    // (Notion API doesn't support filtering by person email directly)
    const response = await this.client.databases.query({
      database_id: this.oncallDbId,
      filter: {
        or: [
          { property: 'Status', status: { equals: 'Scheduled' } },
          { property: 'Status', status: { equals: 'Active' } },
        ],
      },
      sorts: [{ property: 'Shift Dates', direction: 'ascending' }],
    });
    const shifts = response.results.map((page: any) => this.parseShift(page));
    return shifts.filter((s) => s.personEmail === email);
  }

  async updateShiftStatus(pageId: string, status: 'Scheduled' | 'Active' | 'Completed' | 'Cancelled'): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        Status: { status: { name: status } },
      },
    });
  }

  async swapShiftPersons(shiftAId: string, personANotionId: string, shiftBId: string, personBNotionId: string): Promise<void> {
    // Update shift A to person B
    await this.client.pages.update({
      page_id: shiftAId,
      properties: {
        'On-Call Person': { people: [{ id: personBNotionId }] },
      },
    });
    // Update shift B to person A
    try {
      await this.client.pages.update({
        page_id: shiftBId,
        properties: {
          'On-Call Person': { people: [{ id: personANotionId }] },
        },
      });
    } catch (error) {
      // Rollback shift A
      await this.client.pages.update({
        page_id: shiftAId,
        properties: {
          'On-Call Person': { people: [{ id: personANotionId }] },
        },
      });
      throw error;
    }
  }

  // --- Constraints ---

  async createConstraint(personNotionId: string, personName: string, startDate: string, endDate: string, reason: string): Promise<void> {
    await this.client.pages.create({
      parent: { database_id: this.constraintsDbId },
      properties: {
        title: {
          title: [{ text: { content: `${personName} — ${startDate} to ${endDate}` } }],
        },
        Person: { people: [{ id: personNotionId }] },
        'Blackout Dates': {
          date: { start: startDate, end: endDate },
        },
        Reason: {
          rich_text: [{ text: { content: reason } }],
        },
        Status: { select: { name: 'Active' } },
      },
    });
  }

  async getConstraintsForPerson(email: string): Promise<Constraint[]> {
    const response = await this.client.databases.query({
      database_id: this.constraintsDbId,
      filter: {
        property: 'Status',
        select: { equals: 'Active' },
      },
    });
    const constraints = response.results.map((page: any) => this.parseConstraint(page));
    return constraints.filter((c) => c.personEmail === email);
  }

  async getOverlappingShifts(email: string, startDate: string, endDate: string): Promise<Shift[]> {
    const shifts = await this.getShiftsForPerson(email);
    return shifts.filter((s) => {
      return s.startDate < endDate && s.endDate > startDate;
    });
  }

  // --- Parsers ---

  private parseShift(page: any): Shift {
    const props = page.properties;
    const person = props['On-Call Person']?.people?.[0];
    return {
      id: page.id,
      name: props.Date?.title?.[0]?.plain_text || '',
      personNotionId: person?.id || '',
      personEmail: person?.person?.email || '',
      personName: person?.name || '',
      startDate: props['Shift Dates']?.date?.start || '',
      endDate: props['Shift Dates']?.date?.end || '',
      shiftType: props['Shift Type']?.select?.name || 'Regular',
      status: props.Status?.status?.name || 'Scheduled',
    };
  }

  private parseConstraint(page: any): Constraint {
    const props = page.properties;
    const person = props.Person?.people?.[0];
    return {
      id: page.id,
      personNotionId: person?.id || '',
      personEmail: person?.person?.email || '',
      personName: person?.name || '',
      startDate: props['Blackout Dates']?.date?.start || '',
      endDate: props['Blackout Dates']?.date?.end || '',
      reason: props.Reason?.rich_text?.[0]?.plain_text || '',
      status: props.Status?.select?.name || 'Active',
    };
  }
}
```

**Step 4: Run tests**

```bash
npx jest src/services/__tests__/notion.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/notion.ts src/services/__tests__/notion.test.ts
git commit -m "feat: Notion service with shift and constraint operations"
```

---

### Task 3: User Mapping Service

**Files:**
- Create: `src/services/userMapping.ts`
- Create: `src/services/__tests__/userMapping.test.ts`

**Step 1: Write failing test**

```typescript
// src/services/__tests__/userMapping.test.ts
import { UserMappingService } from '../userMapping';

describe('UserMappingService', () => {
  let service: UserMappingService;
  const mockSlackClient = {
    users: {
      lookupByEmail: jest.fn(),
    },
  };

  beforeEach(() => {
    service = new UserMappingService(mockSlackClient as any);
    mockSlackClient.users.lookupByEmail.mockReset();
  });

  it('should resolve Slack user ID from email', async () => {
    mockSlackClient.users.lookupByEmail.mockResolvedValue({
      ok: true,
      user: { id: 'U123', real_name: 'Roee Zolantz' },
    });

    const slackId = await service.getSlackUserId('roee@fhenix.io');
    expect(slackId).toBe('U123');
  });

  it('should cache results', async () => {
    mockSlackClient.users.lookupByEmail.mockResolvedValue({
      ok: true,
      user: { id: 'U123', real_name: 'Roee Zolantz' },
    });

    await service.getSlackUserId('roee@fhenix.io');
    await service.getSlackUserId('roee@fhenix.io');
    expect(mockSlackClient.users.lookupByEmail).toHaveBeenCalledTimes(1);
  });

  it('should return null for unknown email', async () => {
    mockSlackClient.users.lookupByEmail.mockRejectedValue(new Error('users_not_found'));

    const slackId = await service.getSlackUserId('unknown@fhenix.io');
    expect(slackId).toBeNull();
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/services/__tests__/userMapping.test.ts -v
```

**Step 3: Implement UserMappingService**

```typescript
// src/services/userMapping.ts
import { WebClient } from '@slack/web-api';

export class UserMappingService {
  private slackClient: WebClient;
  private cache: Map<string, string | null> = new Map();

  constructor(slackClient: WebClient) {
    this.slackClient = slackClient;
  }

  async getSlackUserId(email: string): Promise<string | null> {
    if (this.cache.has(email)) {
      return this.cache.get(email)!;
    }

    try {
      const result = await this.slackClient.users.lookupByEmail({ email });
      const userId = result.user?.id || null;
      this.cache.set(email, userId);
      return userId;
    } catch {
      this.cache.set(email, null);
      return null;
    }
  }

  async getSlackMention(email: string): Promise<string> {
    const userId = await this.getSlackUserId(email);
    return userId ? `<@${userId}>` : email;
  }
}
```

**Step 4: Run tests**

```bash
npx jest src/services/__tests__/userMapping.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/userMapping.ts src/services/__tests__/userMapping.test.ts
git commit -m "feat: user mapping service with email-to-Slack cache"
```

---

### Task 4: Slack Service

**Files:**
- Create: `src/services/slack.ts`
- Create: `src/services/__tests__/slack.test.ts`

**Step 1: Write failing test**

```typescript
// src/services/__tests__/slack.test.ts
import { SlackService } from '../slack';

describe('SlackService', () => {
  const mockWebClient = {
    chat: { postMessage: jest.fn(), postEphemeral: jest.fn() },
    usergroups: { users: { update: jest.fn() } },
    views: { open: jest.fn() },
    conversations: { open: jest.fn() },
  };

  let service: SlackService;

  beforeEach(() => {
    service = new SlackService(mockWebClient as any, 'C_CHANNEL', 'S_GROUP');
    jest.clearAllMocks();
  });

  it('should post a message to the oncall channel', async () => {
    mockWebClient.chat.postMessage.mockResolvedValue({ ok: true });
    await service.postToChannel('Hello');
    expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C_CHANNEL',
      text: 'Hello',
    });
  });

  it('should update the oncall user group', async () => {
    mockWebClient.usergroups.users.update.mockResolvedValue({ ok: true });
    await service.updateOncallGroup('U123');
    expect(mockWebClient.usergroups.users.update).toHaveBeenCalledWith({
      usergroup: 'S_GROUP',
      users: 'U123',
    });
  });

  it('should send a DM to a user', async () => {
    mockWebClient.conversations.open.mockResolvedValue({ ok: true, channel: { id: 'DM1' } });
    mockWebClient.chat.postMessage.mockResolvedValue({ ok: true });
    await service.sendDM('U123', 'Hey');
    expect(mockWebClient.conversations.open).toHaveBeenCalledWith({ users: 'U123' });
    expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'DM1',
      text: 'Hey',
    });
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/services/__tests__/slack.test.ts -v
```

**Step 3: Implement SlackService**

```typescript
// src/services/slack.ts
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

  async postToChannel(text: string, blocks?: any[]): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text,
      ...(blocks && { blocks }),
    });
  }

  async postEphemeral(channelId: string, userId: string, text: string, blocks?: any[]): Promise<void> {
    await this.client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text,
      ...(blocks && { blocks }),
    });
  }

  async sendDM(userId: string, text: string, blocks?: any[]): Promise<void> {
    const dm = await this.client.conversations.open({ users: userId });
    await this.client.chat.postMessage({
      channel: dm.channel!.id!,
      text,
      ...(blocks && { blocks }),
    });
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

  // --- Message Builders ---

  buildShiftListBlocks(shifts: Shift[], title: string): any[] {
    const header = {
      type: 'header',
      text: { type: 'plain_text', text: title },
    };

    if (shifts.length === 0) {
      return [header, {
        type: 'section',
        text: { type: 'mrkdwn', text: 'No shifts found.' },
      }];
    }

    const rows = shifts.map((s) => {
      const typeEmoji = s.shiftType === 'Holiday' ? ':palm_tree:' : ':calendar:';
      const statusEmoji = s.status === 'Active' ? ':large_green_circle:' : ':white_circle:';
      return `${statusEmoji} *${s.name || 'on-call'}* | ${s.startDate} → ${s.endDate} | ${s.personName} | ${typeEmoji} ${s.shiftType}`;
    });

    return [header, {
      type: 'section',
      text: { type: 'mrkdwn', text: rows.join('\n') },
    }];
  }

  buildSwitchRequestBlocks(requesterName: string, shift: Shift, requestId: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:arrows_counterclockwise: *Switch Request*\n${requesterName} is looking for someone to cover:\n*${shift.name || 'on-call'}* | ${shift.startDate} → ${shift.endDate} | ${shift.shiftType}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: "I'll cover" },
            style: 'primary',
            action_id: 'switch_accept',
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
          text: `:arrows_counterclockwise: *Switch Request from ${requesterName}*\nSwap your *${shiftB.startDate} → ${shiftB.endDate}* with their *${shiftA.startDate} → ${shiftA.endDate}*?`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'switch_approve',
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Decline' },
            style: 'danger',
            action_id: 'switch_decline',
            value: requestId,
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
      blocks: [
        {
          type: 'input',
          block_id: 'start_date',
          label: { type: 'plain_text', text: 'Start Date' },
          element: {
            type: 'datepicker',
            action_id: 'start_date_pick',
          },
        },
        {
          type: 'input',
          block_id: 'end_date',
          label: { type: 'plain_text', text: 'End Date' },
          element: {
            type: 'datepicker',
            action_id: 'end_date_pick',
          },
        },
        {
          type: 'input',
          block_id: 'reason',
          label: { type: 'plain_text', text: 'Reason' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'reason_input',
            placeholder: { type: 'plain_text', text: 'Vacation, conference, etc.' },
          },
        },
      ],
    };
  }
}
```

**Step 4: Run tests**

```bash
npx jest src/services/__tests__/slack.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/slack.ts src/services/__tests__/slack.test.ts
git commit -m "feat: Slack service with messages, modals, and block builders"
```

---

### Task 5: Cron Handler

**Files:**
- Create: `src/handlers/cron.ts`
- Create: `src/handlers/__tests__/cron.test.ts`

**Step 1: Write failing test**

```typescript
// src/handlers/__tests__/cron.test.ts
import { CronHandler } from '../cron';

describe('CronHandler', () => {
  const mockNotionService = {
    getShiftsByDate: jest.fn(),
    getActiveShift: jest.fn(),
    updateShiftStatus: jest.fn(),
    getUpcomingShifts: jest.fn(),
  };
  const mockSlackService = {
    postToChannel: jest.fn(),
    sendDM: jest.fn(),
    updateOncallGroup: jest.fn(),
    buildShiftListBlocks: jest.fn().mockReturnValue([]),
  };
  const mockUserMapping = {
    getSlackUserId: jest.fn(),
    getSlackMention: jest.fn(),
  };

  let handler: CronHandler;

  beforeEach(() => {
    handler = new CronHandler(
      mockNotionService as any,
      mockSlackService as any,
      mockUserMapping as any,
    );
    jest.clearAllMocks();
  });

  describe('handleDaily', () => {
    it('should transition shifts when a new shift starts today', async () => {
      const today = new Date().toISOString().split('T')[0];
      mockNotionService.getShiftsByDate.mockImplementation((date: string) => {
        if (date === today) return [{ id: 'new-shift', personEmail: 'roee@fhenix.io', personName: 'Roee', startDate: today, endDate: '2026-05-04' }];
        return [];
      });
      mockNotionService.getActiveShift.mockResolvedValue({ id: 'old-shift', personEmail: 'haim@fhenix.io' });
      mockUserMapping.getSlackUserId.mockResolvedValue('U_ROEE');
      mockUserMapping.getSlackMention.mockResolvedValue('<@U_ROEE>');

      await handler.handleDaily();

      expect(mockNotionService.updateShiftStatus).toHaveBeenCalledWith('old-shift', 'Completed');
      expect(mockNotionService.updateShiftStatus).toHaveBeenCalledWith('new-shift', 'Active');
      expect(mockSlackService.updateOncallGroup).toHaveBeenCalledWith('U_ROEE');
      expect(mockSlackService.postToChannel).toHaveBeenCalled();
    });

    it('should do nothing if no shift starts today', async () => {
      mockNotionService.getShiftsByDate.mockResolvedValue([]);
      mockNotionService.getActiveShift.mockResolvedValue(null);

      await handler.handleDaily();

      expect(mockNotionService.updateShiftStatus).not.toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/handlers/__tests__/cron.test.ts -v
```

**Step 3: Implement CronHandler**

```typescript
// src/handlers/cron.ts
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

    // Complete the currently active shift
    const activeShift = await this.notion.getActiveShift();
    if (activeShift) {
      await this.notion.updateShiftStatus(activeShift.id, 'Completed');
    }

    for (const shift of newShifts) {
      // Activate the new shift
      await this.notion.updateShiftStatus(shift.id, 'Active');

      // Update @oncall Slack user group
      const slackUserId = await this.userMapping.getSlackUserId(shift.personEmail);
      if (slackUserId) {
        await this.slack.updateOncallGroup(slackUserId);
      }

      // Notify channel
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
```

**Step 4: Run tests**

```bash
npx jest src/handlers/__tests__/cron.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/cron.ts src/handlers/__tests__/cron.test.ts
git commit -m "feat: cron handler with shift transitions and reminders"
```

---

### Task 6: Slash Command Handler

**Files:**
- Create: `src/handlers/slack.ts`
- Create: `src/handlers/__tests__/slack.test.ts`

**Step 1: Write failing test**

```typescript
// src/handlers/__tests__/slack.test.ts
import { SlackCommandHandler } from '../slack';

describe('SlackCommandHandler', () => {
  const mockNotionService = {
    getUpcomingShifts: jest.fn(),
    getActiveShift: jest.fn(),
    getShiftsForPerson: jest.fn(),
  };
  const mockSlackService = {
    postEphemeral: jest.fn(),
    buildShiftListBlocks: jest.fn().mockReturnValue([]),
    openModal: jest.fn(),
    buildConstraintModal: jest.fn().mockReturnValue({}),
  };
  const mockUserMapping = {
    getSlackUserId: jest.fn(),
    getSlackMention: jest.fn(),
  };

  let handler: SlackCommandHandler;

  beforeEach(() => {
    handler = new SlackCommandHandler(
      mockNotionService as any,
      mockSlackService as any,
      mockUserMapping as any,
    );
    jest.clearAllMocks();
  });

  it('should parse "list" subcommand', async () => {
    mockNotionService.getUpcomingShifts.mockResolvedValue([]);
    mockNotionService.getActiveShift.mockResolvedValue(null);

    const result = await handler.handle({
      text: 'list',
      user_id: 'U123',
      user_name: 'roee',
      channel_id: 'C123',
      trigger_id: 'T123',
    });

    expect(mockNotionService.getUpcomingShifts).toHaveBeenCalled();
    expect(result.response_type).toBe('ephemeral');
  });

  it('should parse "now" subcommand', async () => {
    mockNotionService.getActiveShift.mockResolvedValue({
      personName: 'Roee', startDate: '2026-04-20', endDate: '2026-04-27',
    });
    mockUserMapping.getSlackMention.mockResolvedValue('<@U123>');

    const result = await handler.handle({
      text: 'now',
      user_id: 'U123',
      user_name: 'roee',
      channel_id: 'C123',
      trigger_id: 'T123',
    });

    expect(result.text).toContain('on-call');
  });

  it('should return help for unknown subcommand', async () => {
    const result = await handler.handle({
      text: 'unknown',
      user_id: 'U123',
      user_name: 'roee',
      channel_id: 'C123',
      trigger_id: 'T123',
    });

    expect(result.text).toContain('/oncall');
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/handlers/__tests__/slack.test.ts -v
```

**Step 3: Implement SlackCommandHandler**

```typescript
// src/handlers/slack.ts
import { NotionService } from '../services/notion';
import { SlackService } from '../services/slack';
import { UserMappingService } from '../services/userMapping';

interface SlashCommandPayload {
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  trigger_id: string;
}

interface SlashCommandResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: any[];
}

export class SlackCommandHandler {
  constructor(
    private notion: NotionService,
    private slack: SlackService,
    private userMapping: UserMappingService,
  ) {}

  async handle(payload: SlashCommandPayload): Promise<SlashCommandResponse> {
    const [subcommand, ...args] = payload.text.trim().split(/\s+/);

    switch (subcommand?.toLowerCase()) {
      case 'list':
        return this.handleList();
      case 'mine':
        return this.handleMine(payload.user_id);
      case 'now':
        return this.handleNow();
      case 'switch':
        return this.handleSwitch(payload, args);
      case 'add-constraint':
        return this.handleAddConstraint(payload);
      case 'my-constraints':
        return this.handleMyConstraints(payload.user_id);
      case 'help':
      default:
        return this.handleHelp();
    }
  }

  private async handleList(): Promise<SlashCommandResponse> {
    const active = await this.notion.getActiveShift();
    const upcoming = await this.notion.getUpcomingShifts();
    const all = active ? [active, ...upcoming] : upcoming;
    const blocks = this.slack.buildShiftListBlocks(all, 'On-Call Schedule');

    return { response_type: 'ephemeral', text: 'On-Call Schedule', blocks };
  }

  private async handleMine(slackUserId: string): Promise<SlashCommandResponse> {
    // Look up user email from Slack
    const shifts = await this.getShiftsForSlackUser(slackUserId);
    if (!shifts) {
      return { response_type: 'ephemeral', text: "Couldn't find your Notion account. Make sure your Slack and Notion emails match." };
    }
    const blocks = this.slack.buildShiftListBlocks(shifts, 'Your Shifts');
    return { response_type: 'ephemeral', text: 'Your Shifts', blocks };
  }

  private async handleNow(): Promise<SlashCommandResponse> {
    const active = await this.notion.getActiveShift();
    if (!active) {
      return { response_type: 'ephemeral', text: 'No one is currently on-call.' };
    }
    const mention = await this.userMapping.getSlackMention(active.personEmail);
    return {
      response_type: 'ephemeral',
      text: `:phone: ${mention} is on-call now (${active.startDate} → ${active.endDate})`,
    };
  }

  private async handleSwitch(payload: SlashCommandPayload, args: string[]): Promise<SlashCommandResponse> {
    // Defer — this is handled async via interactions
    return {
      response_type: 'ephemeral',
      text: ':hourglass_flowing_sand: Working on your switch request...',
    };
  }

  private async handleAddConstraint(payload: SlashCommandPayload): Promise<SlashCommandResponse> {
    const modal = this.slack.buildConstraintModal(payload.trigger_id);
    await this.slack.openModal(payload.trigger_id, modal);
    return { response_type: 'ephemeral', text: 'Opening constraint form...' };
  }

  private async handleMyConstraints(slackUserId: string): Promise<SlashCommandResponse> {
    // Placeholder — will look up constraints for user
    return { response_type: 'ephemeral', text: 'Loading your constraints...' };
  }

  private handleHelp(): SlashCommandResponse {
    const text = [
      '*On-Call Commands:*',
      '`/oncall list` — Show all upcoming shifts',
      '`/oncall mine` — Show your shifts',
      '`/oncall now` — Who\'s on-call right now?',
      '`/oncall switch` — Request a shift swap (broadcast)',
      '`/oncall switch @user` — Request a direct swap',
      '`/oncall add-constraint` — Add a blackout period',
      '`/oncall my-constraints` — Show your constraints',
      '`/oncall help` — Show this message',
    ].join('\n');

    return { response_type: 'ephemeral', text };
  }

  private async getShiftsForSlackUser(slackUserId: string): Promise<any[] | null> {
    // Reverse lookup: we need the email for this Slack user
    // This will be implemented using Slack users.info
    return [];
  }
}
```

**Step 4: Run tests**

```bash
npx jest src/handlers/__tests__/slack.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/slack.ts src/handlers/__tests__/slack.test.ts
git commit -m "feat: slash command handler with list, mine, now, switch, help"
```

---

### Task 7: Interaction Handler (Buttons & Modals)

**Files:**
- Create: `src/handlers/interactions.ts`
- Create: `src/handlers/__tests__/interactions.test.ts`

**Step 1: Write failing test**

```typescript
// src/handlers/__tests__/interactions.test.ts
import { InteractionHandler } from '../interactions';

describe('InteractionHandler', () => {
  const mockNotionService = {
    swapShiftPersons: jest.fn(),
    createConstraint: jest.fn(),
    getOverlappingShifts: jest.fn(),
  };
  const mockSlackService = {
    postToChannel: jest.fn(),
    sendDM: jest.fn(),
  };
  const mockUserMapping = {
    getSlackUserId: jest.fn(),
    getSlackMention: jest.fn(),
  };

  let handler: InteractionHandler;

  beforeEach(() => {
    handler = new InteractionHandler(
      mockNotionService as any,
      mockSlackService as any,
      mockUserMapping as any,
    );
    jest.clearAllMocks();
  });

  describe('handleBlockAction', () => {
    it('should handle switch_accept action', async () => {
      mockNotionService.swapShiftPersons.mockResolvedValue(undefined);
      mockUserMapping.getSlackMention.mockResolvedValue('<@U456>');

      await handler.handleBlockAction({
        action_id: 'switch_accept',
        value: JSON.stringify({
          requesterShiftId: 'shift-a',
          requesterPersonId: 'person-a',
        }),
        user: { id: 'U456' },
      });

      expect(mockSlackService.postToChannel).toHaveBeenCalled();
    });
  });

  describe('handleViewSubmission', () => {
    it('should handle add_constraint modal', async () => {
      mockNotionService.createConstraint.mockResolvedValue(undefined);
      mockNotionService.getOverlappingShifts.mockResolvedValue([]);

      await handler.handleViewSubmission({
        callback_id: 'add_constraint',
        user: { id: 'U123' },
        values: {
          start_date: { start_date_pick: { selected_date: '2026-06-01' } },
          end_date: { end_date_pick: { selected_date: '2026-06-08' } },
          reason: { reason_input: { value: 'Vacation' } },
        },
      });

      expect(mockNotionService.createConstraint).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/handlers/__tests__/interactions.test.ts -v
```

**Step 3: Implement InteractionHandler**

```typescript
// src/handlers/interactions.ts
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
    const actionId = payload.action_id;

    switch (actionId) {
      case 'switch_accept':
        await this.handleSwitchAccept(payload);
        break;
      case 'switch_approve':
        await this.handleSwitchApprove(payload);
        break;
      case 'switch_decline':
        await this.handleSwitchDecline(payload);
        break;
    }
  }

  async handleViewSubmission(payload: any): Promise<void> {
    const callbackId = payload.callback_id;

    switch (callbackId) {
      case 'add_constraint':
        await this.handleConstraintSubmission(payload);
        break;
    }
  }

  private async handleSwitchAccept(payload: any): Promise<void> {
    const requestData = JSON.parse(payload.value);
    const volunteerId = payload.user.id;

    try {
      await this.notion.swapShiftPersons(
        requestData.requesterShiftId,
        requestData.requesterPersonId,
        requestData.volunteerShiftId || requestData.requesterShiftId,
        requestData.volunteerPersonId || '',
      );

      const volunteerMention = `<@${volunteerId}>`;
      await this.slack.postToChannel(
        `:white_check_mark: Shift swap completed! ${volunteerMention} is covering the shift.`
      );
    } catch (error) {
      await this.slack.sendDM(volunteerId, ':x: Failed to process the shift swap. Please try again.');
    }
  }

  private async handleSwitchApprove(payload: any): Promise<void> {
    const requestData = JSON.parse(payload.value);

    try {
      await this.notion.swapShiftPersons(
        requestData.shiftAId,
        requestData.personAId,
        requestData.shiftBId,
        requestData.personBId,
      );

      await this.slack.postToChannel(':white_check_mark: Direct shift swap approved and completed!');
      await this.slack.sendDM(requestData.requesterId, ':white_check_mark: Your switch request was approved!');
    } catch (error) {
      await this.slack.sendDM(payload.user.id, ':x: Failed to process the shift swap. Please try again.');
    }
  }

  private async handleSwitchDecline(payload: any): Promise<void> {
    const requestData = JSON.parse(payload.value);
    await this.slack.sendDM(
      requestData.requesterId,
      ':x: Your switch request was declined.'
    );
  }

  private async handleConstraintSubmission(payload: any): Promise<void> {
    const values = payload.values;
    const startDate = values.start_date.start_date_pick.selected_date;
    const endDate = values.end_date.end_date_pick.selected_date;
    const reason = values.reason?.reason_input?.value || '';
    const userId = payload.user.id;

    // TODO: resolve Slack user to Notion person ID + email
    // For now, we need a reverse lookup
    const personNotionId = ''; // Will be resolved via userMapping
    const personName = '';

    // Check for overlapping shifts
    const overlapping = await this.notion.getOverlappingShifts('', startDate, endDate);
    if (overlapping.length > 0) {
      await this.slack.sendDM(
        userId,
        `:warning: You have ${overlapping.length} shift(s) during this period. Consider requesting a switch first.`
      );
    }

    await this.notion.createConstraint(personNotionId, personName, startDate, endDate, reason);
    await this.slack.sendDM(userId, `:white_check_mark: Constraint added: ${startDate} → ${endDate}`);
  }
}
```

**Step 4: Run tests**

```bash
npx jest src/handlers/__tests__/interactions.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/interactions.ts src/handlers/__tests__/interactions.test.ts
git commit -m "feat: interaction handler for buttons and modal submissions"
```

---

### Task 8: HTTP Entry Point

**Files:**
- Create: `src/index.ts`
- Create: `src/__tests__/index.test.ts`

**Step 1: Write failing test**

```typescript
// src/__tests__/index.test.ts
import { routeRequest } from '../index';

describe('routeRequest', () => {
  it('should route /cron/daily to cron handler', () => {
    const route = routeRequest('/cron/daily', 'POST');
    expect(route).toBe('cron');
  });

  it('should route /slack/commands to slash command handler', () => {
    const route = routeRequest('/slack/commands', 'POST');
    expect(route).toBe('slash_command');
  });

  it('should route /slack/interactions to interaction handler', () => {
    const route = routeRequest('/slack/interactions', 'POST');
    expect(route).toBe('interaction');
  });

  it('should return health for GET /', () => {
    const route = routeRequest('/', 'GET');
    expect(route).toBe('health');
  });
});
```

**Step 2: Run tests to verify failure**

```bash
npx jest src/__tests__/index.test.ts -v
```

**Step 3: Implement entry point**

```typescript
// src/index.ts
import { http } from '@google-cloud/functions-framework';
import { WebClient } from '@slack/web-api';
import { config } from './config';
import { NotionService } from './services/notion';
import { SlackService } from './services/slack';
import { UserMappingService } from './services/userMapping';
import { CronHandler } from './handlers/cron';
import { SlackCommandHandler } from './handlers/slack';
import { InteractionHandler } from './handlers/interactions';
import crypto from 'crypto';

// Initialize services
const notionService = new NotionService(
  config.notion.apiKey,
  config.notion.oncallDbId,
  config.notion.constraintsDbId,
);
const slackWebClient = new WebClient(config.slack.botToken);
const slackService = new SlackService(
  slackWebClient,
  config.slack.oncallChannel,
  config.slack.oncallUsergroupId,
);
const userMapping = new UserMappingService(slackWebClient);

// Initialize handlers
const cronHandler = new CronHandler(notionService, slackService, userMapping);
const commandHandler = new SlackCommandHandler(notionService, slackService, userMapping);
const interactionHandler = new InteractionHandler(notionService, slackService, userMapping);

export function routeRequest(path: string, method: string): string {
  if (method === 'GET' && path === '/') return 'health';
  if (method === 'POST' && path === '/cron/daily') return 'cron';
  if (method === 'POST' && path === '/slack/commands') return 'slash_command';
  if (method === 'POST' && path === '/slack/interactions') return 'interaction';
  return 'not_found';
}

function verifySlackRequest(req: any): boolean {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', config.slack.signingSecret)
    .update(sigBasestring)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
}

function verifyCronRequest(req: any): boolean {
  const secret = req.headers['x-cron-secret'] || req.query?.secret;
  return secret === config.cron.secret;
}

http('app', async (req, res) => {
  const route = routeRequest(req.path, req.method);

  try {
    switch (route) {
      case 'health':
        res.status(200).json({ status: 'ok', service: 'notion-oncaller' });
        return;

      case 'cron':
        if (!verifyCronRequest(req)) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        await cronHandler.handleDaily();
        res.status(200).json({ ok: true });
        return;

      case 'slash_command':
        if (!verifySlackRequest(req)) {
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
        // Acknowledge immediately
        const commandResult = await commandHandler.handle(req.body);
        res.status(200).json(commandResult);
        return;

      case 'interaction':
        if (!verifySlackRequest(req)) {
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
        const interactionPayload = JSON.parse(req.body.payload);
        // Acknowledge immediately
        res.status(200).send('');

        // Process async
        if (interactionPayload.type === 'block_actions') {
          const action = interactionPayload.actions[0];
          await interactionHandler.handleBlockAction({
            ...action,
            user: interactionPayload.user,
          });
        } else if (interactionPayload.type === 'view_submission') {
          await interactionHandler.handleViewSubmission({
            callback_id: interactionPayload.view.callback_id,
            user: interactionPayload.user,
            values: interactionPayload.view.state.values,
          });
        }
        return;

      default:
        res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    console.error('Error handling request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 4: Run tests**

```bash
npx jest src/__tests__/index.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts src/__tests__/index.test.ts
git commit -m "feat: HTTP entry point with routing, Slack verification, and cron auth"
```

---

### Task 9: Constraints DB Setup

**Files:**
- Create: `deploy/setup-constraints-db.ts`

**Step 1: Create a script to set up the Constraints database in Notion**

This is a one-time setup script run manually.

```typescript
// deploy/setup-constraints-db.ts
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function createConstraintsDb() {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    console.error('Set NOTION_PARENT_PAGE_ID to the OnCall Shifts Space page ID');
    process.exit(1);
  }

  const response = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'On-Call Constraints' } }],
    properties: {
      Title: { title: {} },
      Person: { people: {} },
      'Blackout Dates': { date: {} },
      Reason: { rich_text: {} },
      Status: {
        select: {
          options: [
            { name: 'Active', color: 'green' },
            { name: 'Expired', color: 'gray' },
            { name: 'Cancelled', color: 'red' },
          ],
        },
      },
    },
  });

  console.log('Constraints DB created!');
  console.log('Database ID:', response.id);
  console.log('Add this to your .env as NOTION_CONSTRAINTS_DB_ID');
}

createConstraintsDb().catch(console.error);
```

**Step 2: Commit**

```bash
git add deploy/setup-constraints-db.ts
git commit -m "feat: setup script for Notion Constraints database"
```

---

### Task 10: Deployment Scripts

**Files:**
- Create: `deploy/deploy.sh`
- Create: `deploy/setup-scheduler.sh`

**Step 1: Create deploy.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Deploy the Cloud Function
# Usage: ./deploy/deploy.sh [project-id] [region]

PROJECT_ID="${1:-$(gcloud config get-value project)}"
REGION="${2:-me-west1}"
FUNCTION_NAME="notion-oncaller"

echo "Building..."
npm run build

echo "Deploying to $PROJECT_ID ($REGION)..."
gcloud functions deploy "$FUNCTION_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=app \
  --source=. \
  --set-env-vars="$(cat .env | grep -v '^#' | grep -v '^$' | tr '\n' ',')" \
  --memory=256MB \
  --timeout=60s \
  --gen2

FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(serviceConfig.uri)')

echo ""
echo "Deployed! Function URL: $FUNCTION_URL"
echo ""
echo "Configure in Slack app:"
echo "  Slash Command URL:  ${FUNCTION_URL}/slack/commands"
echo "  Interactivity URL:  ${FUNCTION_URL}/slack/interactions"
echo ""
echo "Next: run deploy/setup-scheduler.sh $FUNCTION_URL"
```

**Step 2: Create setup-scheduler.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Create Cloud Scheduler job for daily cron
# Usage: ./deploy/setup-scheduler.sh <function-url>

FUNCTION_URL="${1:?Usage: setup-scheduler.sh <function-url>}"
PROJECT_ID="${2:-$(gcloud config get-value project)}"
REGION="${3:-me-west1}"
CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET env var}"

JOB_NAME="notion-oncaller-daily"

# Delete existing job if it exists
gcloud scheduler jobs delete "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --quiet 2>/dev/null || true

# Create new job
gcloud scheduler jobs create http "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --schedule="30 9 * * *" \
  --time-zone="Asia/Jerusalem" \
  --uri="${FUNCTION_URL}/cron/daily" \
  --http-method=POST \
  --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
  --message-body='{"trigger":"scheduled"}' \
  --attempt-deadline=60s

echo "Scheduler job created: $JOB_NAME"
echo "Schedule: 09:30 daily (Asia/Jerusalem)"
echo "Target: ${FUNCTION_URL}/cron/daily"
```

**Step 3: Make scripts executable and commit**

```bash
chmod +x deploy/deploy.sh deploy/setup-scheduler.sh
git add deploy/deploy.sh deploy/setup-scheduler.sh
git commit -m "feat: deployment and scheduler setup scripts"
```

---

### Task 11: Documentation

**Files:**
- Create: `README.md`
- Create: `docs/SETUP.md`
- Create: `docs/SLACK_APP_SETUP.md`
- Create: `LICENSE`

**Step 1: Create README.md**

```markdown
# notion-oncaller

Slack-integrated on-call management tool backed by Notion. Deployed as a single GCP Cloud Function.

## Features

- **Slash commands** — `/oncall list`, `/oncall mine`, `/oncall now`, `/oncall switch`, `/oncall add-constraint`, and more
- **Daily automation** — shift transitions, `@oncall` group updates, channel notifications
- **Reminders** — DMs 1 day and 7 days before your shift
- **Constraints** — block out dates you're unavailable
- **Shift swaps** — request swaps via broadcast or direct request

## Architecture

```
Slack ──HTTP──▶ GCP Cloud Function ──API──▶ Notion
                      ▲
Cloud Scheduler ──HTTP┘ (daily 9:30 IL)
```

- **Runtime:** Node.js 20, TypeScript
- **Data store:** Notion (sole source of truth)
- **Interface:** Slack (sole UI)
- **Hosting:** GCP Cloud Function (event-driven, not 24/7)

## Quick Start

1. **Clone and install:**
   ```bash
   git clone https://github.com/fhenixio/notion-oncaller.git
   cd notion-oncaller
   npm install
   ```

2. **Set up Slack app** — see [docs/SLACK_APP_SETUP.md](docs/SLACK_APP_SETUP.md)

3. **Set up Notion integration** — see [docs/SETUP.md](docs/SETUP.md)

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Fill in your values
   ```

5. **Deploy:**
   ```bash
   ./deploy/deploy.sh
   ./deploy/setup-scheduler.sh <function-url>
   ```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/oncall list` | Show all upcoming shifts |
| `/oncall mine` | Show your shifts |
| `/oncall now` | Who's on-call right now? |
| `/oncall switch` | Broadcast swap request |
| `/oncall switch @user` | Direct swap request |
| `/oncall add-constraint` | Add a blackout period |
| `/oncall my-constraints` | Show your constraints |
| `/oncall help` | Show available commands |

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode + local server
npm test               # Run tests
npm run test:watch     # Watch mode tests
```

## License

MIT — see [LICENSE](LICENSE)
```

**Step 2: Create docs/SETUP.md**

```markdown
# Setup Guide

## Prerequisites

- Node.js 20+
- GCP project with billing enabled
- `gcloud` CLI installed and authenticated
- Notion workspace with admin access
- Slack workspace with admin access

## Step 1: Notion Setup

### Create Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Name it "On-Call Bot"
4. Copy the **Internal Integration Secret** → this is your `NOTION_API_KEY`

### Share Databases

1. Open your On-Call Schedule database in Notion
2. Click "..." → "Connections" → Add your integration
3. Copy the database ID from the URL → `NOTION_ONCALL_DB_ID`

### Create Constraints Database

```bash
NOTION_API_KEY=your_key NOTION_PARENT_PAGE_ID=your_page_id npx ts-node deploy/setup-constraints-db.ts
```

Copy the output database ID → `NOTION_CONSTRAINTS_DB_ID`

Share it with the integration (same as above).

## Step 2: Slack Setup

See [SLACK_APP_SETUP.md](SLACK_APP_SETUP.md)

## Step 3: Deploy

```bash
cp .env.example .env
# Fill in all values

./deploy/deploy.sh your-gcp-project me-west1
./deploy/setup-scheduler.sh https://your-function-url
```

## Step 4: Verify

1. Run `/oncall help` in Slack
2. Run `/oncall list` to see your shifts
3. Check GCP Console → Cloud Scheduler to verify the daily job
```

**Step 3: Create docs/SLACK_APP_SETUP.md**

```markdown
# Slack App Setup

## Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: "On-Call Bot", pick your workspace

## Configure Slash Command

1. Go to **Slash Commands** → **Create New Command**
2. Command: `/oncall`
3. Request URL: `https://YOUR_FUNCTION_URL/slack/commands`
4. Short Description: "Manage on-call shifts"
5. Usage Hint: `list | mine | now | switch | add-constraint | my-constraints | help`

## Configure Interactivity

1. Go to **Interactivity & Shortcuts** → Enable
2. Request URL: `https://YOUR_FUNCTION_URL/slack/interactions`

## Bot Permissions (OAuth & Permissions)

Add these **Bot Token Scopes:**

- `chat:write` — send messages
- `chat:write.public` — send to channels the bot isn't in
- `commands` — slash commands
- `im:write` — open DMs
- `users:read` — look up users
- `users:read.email` — look up users by email
- `usergroups:write` — update @oncall group
- `usergroups:read` — read user group info

## Install to Workspace

1. Go to **Install App** → **Install to Workspace**
2. Copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
3. Go to **Basic Information** → **App Credentials**
4. Copy **Signing Secret** → `SLACK_SIGNING_SECRET`

## Get Channel and User Group IDs

**Channel ID:**
- Right-click the channel in Slack → "View channel details"
- Copy the Channel ID at the bottom → `SLACK_ONCALL_CHANNEL`

**User Group ID:**
- Run in Slack: `/oncall help` (if already deployed)
- Or use Slack API: `usergroups.list` → find @oncall → copy ID → `SLACK_ONCALL_USERGROUP_ID`
```

**Step 4: Create LICENSE**

```
MIT License

Copyright (c) 2026 Fhenix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 5: Commit**

```bash
git add README.md docs/SETUP.md docs/SLACK_APP_SETUP.md LICENSE
git commit -m "docs: README, setup guides, Slack app guide, and MIT license"
```

---

### Task 12: Run All Tests & Final Build

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run build**

```bash
npm run build
```

Expected: Clean compile, no errors

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and build verification"
```

---

## Task Dependency Order

```
Task 1  (scaffolding)
  ↓
Task 2  (Notion service)
Task 3  (user mapping) — parallel with 2
Task 4  (Slack service) — parallel with 2, 3
  ↓
Task 5  (cron handler) — needs 2, 3, 4
Task 6  (slash command handler) — needs 2, 3, 4
Task 7  (interaction handler) — needs 2, 3, 4
  ↓
Task 8  (HTTP entry point) — needs 5, 6, 7
Task 9  (constraints DB setup) — needs 2
  ↓
Task 10 (deployment scripts)
Task 11 (documentation)
  ↓
Task 12 (final tests & build)
```
