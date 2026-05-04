# notion-oncaller

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Slack-integrated on-call management tool backed by Notion. Deployed as a single GCP Cloud Function.

Manage your team's on-call schedule entirely through Slack slash commands, with Notion as the source of truth. Daily automations handle shift transitions, reminders, and `@oncall` user group updates — no manual bookkeeping needed.

---

## Features

- :calendar: **Shift management** — view, switch, and swap on-call shifts from Slack
- :bell: **Smart reminders** — DMs sent 1 day and 7 days before your shift
- :arrows_counterclockwise: **Shift swaps** — broadcast requests to the team or ask someone directly
- :no_entry_sign: **Constraints** — block out dates you're unavailable
- :robot_face: **Daily automation** — shift transitions, `@oncall` group updates, channel notifications
- :lock: **Secure** — Slack signature verification, OIDC-authenticated cron, shared secret validation

---

## Architecture

```
┌─────────┐         ┌─────────────────────────┐         ┌─────────┐
│  Slack   │──HTTP──>│  GCP Cloud Function     │──API──> │  Notion │
│  (UI)    │<──────  │  (Node.js / TypeScript)  │<──────  │  (Data) │
└─────────┘         └─────────────────────────┘         └─────────┘
                              ^
                              │ HTTP (OIDC auth)
                    ┌─────────┴─────────┐
                    │  Cloud Scheduler   │
                    │  (daily 09:30)     │
                    └───────────────────┘
```

- **Runtime:** Node.js 20, TypeScript (strict mode)
- **Data store:** Notion databases (sole source of truth)
- **Interface:** Slack (sole UI — slash commands + interactive messages)
- **Hosting:** GCP Cloud Function (event-driven, scales to zero)

---

## Prerequisites

- **GCP account** with billing enabled (Cloud Functions, Cloud Scheduler, Artifact Registry)
- **Slack workspace** with admin access to create apps
- **Notion workspace** with an integration and on-call databases set up

---

## Quick Start

1. **Clone and install:**
   ```bash
   git clone https://github.com/roeezolantz/notion-oncaller.git
   cd notion-oncaller
   npm install
   ```

2. **Set up Notion integration:**
   - Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Share your On-Call Schedule and Constraints databases with the integration
   - See [docs/SETUP.md](docs/SETUP.md) for detailed instructions

3. **Set up Slack app:**
   - Create a new app at [api.slack.com/apps](https://api.slack.com/apps)
   - Configure slash commands, interactivity, and bot scopes
   - See [docs/SLACK_APP_SETUP.md](docs/SLACK_APP_SETUP.md) for detailed instructions

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Fill in your Notion, Slack, and app values
   ```

5. **Build and test:**
   ```bash
   npm run build
   npm test
   ```

6. **Deploy:**
   ```bash
   ./deploy/deploy.sh
   ./deploy/setup-scheduler.sh <function-url>
   ```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/oncall list` | Show all upcoming shifts |
| `/oncall mine` | Show your upcoming shifts |
| `/oncall now` | Who's on-call right now? |
| `/oncall replacement` | Need someone to cover your shift (one-way) |
| `/oncall swap` | Trade shifts with someone (two-way, proposal-based) |
| `/oncall block` | Block out dates you're unavailable |
| `/oncall my-blocks` | Show your blocked dates |
| `/oncall broadcast` | Preview, then DM every on-call their upcoming shifts (admin-only send) |
| `/oncall help` | Show available commands |

---

## How Replacement Works

One-way coverage — someone takes your shift, no trade needed:

1. Run `/oncall replacement` — a modal shows your upcoming shifts
2. Pick which shift you need covered
3. Bot posts to the channel: "Alice needs someone to cover May 4-11"
4. A teammate clicks **"I'll cover"**
5. The shift is reassigned to them in Notion — done
6. The original message updates to show the result (buttons removed)

---

## How Swap Works

Two-way trade — both shifts change owners:

1. Run `/oncall swap` — pick which shift you want to trade
2. Bot posts to the channel: "Alice wants to swap her May 4-11 shift"
3. Teammates click **"Propose my shift"** — a modal shows their shifts to offer
4. You receive a DM for each proposal with **Accept** / **Decline** buttons
5. Click Accept on the one you want — both shifts swap in Notion
6. Both parties and the channel are notified

---

## How Blocks Work

Block out dates when you're unavailable:

1. Run `/oncall block` — a modal opens with date pickers
2. Select start date, end date, and optional reason
3. The block is saved to the Notion Constraints database
4. If your blocked dates overlap an existing shift, you'll get a warning
5. View your blocks anytime with `/oncall my-blocks`

---

## How Broadcast Works

Send every on-call team member a DM with their upcoming shifts — useful after schedule changes:

1. Anyone runs `/oncall broadcast` — an ephemeral preview shows who would be DM'd and the exact shift list per person.
2. Admins (listed in `ONCALL_ADMINS`) see **Send** and **Cancel** buttons; non-admins see the same preview with a notice that only admins can send.
3. Click **Send** — the plan is rebuilt against current Notion state (a true dry-run preview), and DMs go out one by one with action buttons:
   - **View Full Schedule** — opens `NOTION_SCHEDULE_URL`
   - **Request Replacement** — opens the same picker as `/oncall replacement`
   - **Request Swap** — opens the same picker as `/oncall swap`
4. The preview message is replaced with a result line: `Sent to N. Skipped M (no Slack mapping). Failed K (see logs).`
5. People with no upcoming shifts or no Slack mapping are skipped automatically.

---

## Daily Automation

Every day at 09:30 (configurable timezone), Cloud Scheduler triggers the `/cron/daily` endpoint:

1. **Shift transition** — detects if the on-call person changed today
2. **User group update** — sets `@oncall` to the current on-call person
3. **Channel notification** — posts a shift change message if applicable
4. **Upcoming reminders** — DMs people whose shifts start in 1 day or 7 days

---

## Security

| Layer | Mechanism |
|-------|-----------|
| Slack requests | Slack signing secret verification (HMAC-SHA256) |
| Cron endpoint | OIDC token authentication via GCP service account |
| Cron validation | Shared `CRON_SECRET` header check |

---

## Notion Permissions

Your Notion integration needs these capabilities:

| Permission | Why |
|------------|-----|
| **Read content** | Query on-call schedule and constraints |
| **Insert content** | Create new constraint entries |
| **Update content** | Swap/replace shift assignments |

---

## Slack Bot Scopes

Your Slack app needs these OAuth scopes:

| Scope | Why |
|-------|-----|
| `chat:write` | Post messages to the on-call channel |
| `commands` | Register slash commands |
| `im:write` | Send reminder DMs to users |
| `users:read` | Look up user info for display names |
| `users:read.email` | Match Slack users to Notion entries by email |
| `usergroups:write` | Update `@oncall` user group membership |
| `usergroups:read` | Read current user group membership |

---

## GCP Services Used

| Service | Purpose |
|---------|---------|
| **Cloud Functions** | Hosts the application (single function, scales to zero) |
| **Cloud Scheduler** | Triggers the daily automation cron job |
| **Artifact Registry** | Stores container images for deployment |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NOTION_API_KEY` | Notion integration secret token |
| `NOTION_ONCALL_DB_ID` | Data source ID from On-Call Schedule database |
| `NOTION_CONSTRAINTS_DB_ID` | Data source ID from On-Call Constraints database |
| `NOTION_CONSTRAINTS_PAGE_ID` | Database page ID from On-Call Constraints (for creating pages) |
| `NOTION_SCHEDULE_URL` | Full Notion URL to your On-Call Schedule (used in Slack buttons) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack App Credentials signing secret |
| `SLACK_ONCALL_CHANNEL` | Slack channel ID for notifications |
| `SLACK_ONCALL_USERGROUP_ID` | Slack `@oncall` user group ID |
| `CRON_SECRET` | Shared secret for cron endpoint authentication |
| `ONCALL_ADMINS` | Comma-separated emails allowed to send `/oncall broadcast` (e.g. `alice@example.com,bob@example.com`) |

---

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode + local server
npm test               # Run tests
npm run test:watch     # Watch mode tests
npm run test:coverage  # Tests with coverage report
npm run lint           # Lint source files
```

### Local Development

1. Copy `.env.example` to `.env` and fill in your values
2. Run `npm run dev` to start the local server with file watching
3. Use a tunnel (e.g., ngrok) to expose your local server to Slack

---

## Deployment

### Deploy the Cloud Function

```bash
./deploy/deploy.sh
```

### Set Up the Scheduler

```bash
# Default: Asia/Jerusalem timezone
./deploy/setup-scheduler.sh <function-url>

# Custom timezone
./deploy/setup-scheduler.sh <function-url> <project-id> <region> <service-account> America/New_York

# Arguments:
#   1. function-url      (required) — deployed function URL
#   2. project-id        (optional) — GCP project, defaults to gcloud config
#   3. region            (optional) — GCP region, defaults to me-west1
#   4. service-account   (optional) — OIDC service account
#   5. timezone          (optional) — defaults to Asia/Jerusalem
```

---

## Project Structure

```
notion-oncaller/
├── src/
│   ├── index.ts                  # Cloud Function entry point
│   ├── config.ts                 # Environment configuration
│   ├── utils.ts                  # Shared utilities
│   ├── types/
│   │   └── index.ts              # TypeScript type definitions
│   ├── handlers/
│   │   ├── slack.ts              # Slash command handlers
│   │   ├── interactions.ts       # Interactive message handlers
│   │   ├── cron.ts               # Daily automation handler
│   │   └── __tests__/            # Handler tests
│   └── services/
│       ├── notion.ts             # Notion API client
│       ├── slack.ts              # Slack API client
│       ├── userMapping.ts        # Slack ↔ Notion user mapping
│       └── __tests__/            # Service tests
├── deploy/
│   ├── deploy.sh                 # Cloud Function deployment script
│   ├── setup-scheduler.sh        # Cloud Scheduler setup script
│   └── setup-constraints-db.ts   # Constraints DB setup helper
├── docs/                         # Setup guides
├── .env.example                  # Environment template
├── tsconfig.json                 # TypeScript configuration
├── jest.config.js                # Jest configuration
└── package.json
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE)
