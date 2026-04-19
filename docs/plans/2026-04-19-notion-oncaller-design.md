# notion-oncaller — Design Document

**Date:** 2026-04-19
**Status:** Approved

## Overview

notion-oncaller is a Slack-integrated on-call management tool backed by Notion. A single GCP Cloud Function (TypeScript) connects Slack slash commands and a daily cron job to Notion databases that store shifts and constraints.

The function is event-driven (triggered, not 24/7) — it only runs when invoked by Slack or Cloud Scheduler.

## Architecture

```
┌─────────────┐     HTTP      ┌──────────────────────┐     API     ┌────────┐
│  Slack       │ ──────────── │  GCP Cloud Function   │ ──────────│ Notion  │
│  (commands)  │              │  notion-oncaller      │            │  DB     │
└─────────────┘              └──────────────────────┘            └────────┘
                                       ▲
┌─────────────┐     HTTP      │
│  GCP Cloud   │ ─────────────┘
│  Scheduler   │  (daily 9:30 IL)
└─────────────┘
```

**Components:**
- Single Cloud Function (Node.js 20 / TypeScript) — handles Slack interactions + scheduled tasks
- GCP Cloud Scheduler — one HTTP cron job: `30 9 * * *` Asia/Jerusalem
- Notion — source of truth (On-Call Schedule DB + Constraints DB)
- Slack — user interface (slash commands, notifications, @oncall user group)

## Slash Commands

All commands go through `/oncall <subcommand>`:

| Command | Description | Response |
|---------|-------------|----------|
| `/oncall list` | Show all upcoming shifts | Formatted table (ephemeral) |
| `/oncall mine` | Show current user's shifts | Filtered list for requesting user |
| `/oncall now` | Who's on-call right now? | Active shift + person |
| `/oncall switch` | Broadcast swap request | Posts to channel with "I'll cover" button |
| `/oncall switch @user` | Direct swap request | DMs target with Approve/Decline buttons |
| `/oncall add-constraint` | Add a blackout period | Opens Slack modal with date pickers + reason |
| `/oncall my-constraints` | Show my blackout dates | Ephemeral list |
| `/oncall help` | List available commands | Command reference |

## Daily Cron Job (09:30 Asia/Jerusalem)

Runs three checks:

1. **Shift change** — if a shift starts today:
   - Set previous shift to Completed
   - Set new shift to Active
   - Update `@oncall` Slack user group membership
   - Post notification to configured channel
2. **1-day reminder** — if a shift starts tomorrow: DM the person
3. **7-day reminder** — if a shift starts in 7 days: DM the person

## Interaction Flows

### Switch (broadcast)
1. User runs `/oncall switch`
2. App posts to channel with shift details + "I'll cover" button
3. Volunteer clicks button
4. App swaps both shifts in Notion
5. Confirms to both users

### Switch (direct)
1. User runs `/oncall switch @target`
2. App DMs target with Approve/Decline buttons
3. Target approves → app swaps shifts in Notion → confirms to both
4. Target declines → notifies requester
5. No response after 48h → auto-expires, notifies requester

### Add Constraint
1. User runs `/oncall add-constraint`
2. Slack modal opens: two date pickers (start/end) + reason text field
3. User submits
4. App creates entry in Notion Constraints DB
5. If constraint overlaps an existing shift, warns the user

## Data Model

### On-Call Schedule DB (existing, no changes)

| Property | Type | Values |
|----------|------|--------|
| Date | title | Shift name |
| On-Call Person | person | Notion user |
| Shift Dates | date (range) | start → end |
| Shift Type | select | Regular, Backup Standby, Backup Used, Holiday |
| Status | status | Scheduled, Active, Completed, Cancelled |
| Points | formula | auto-calculated from type × days |

### Constraints DB (new)

| Property | Type | Description |
|----------|------|-------------|
| Title | title | Auto: "{Person} — {dates}" |
| Person | person | Who's unavailable |
| Blackout Dates | date (range) | start → end |
| Reason | rich_text | Optional |
| Status | select | Active, Expired, Cancelled |

## User Mapping

Notion ↔ Slack mapping via shared email. The app uses Slack's `users.lookupByEmail` with the Notion user's email. No manual mapping table needed — everyone uses @fhenix.io in both systems.

## Project Structure

```
notion-oncaller/
├── src/
│   ├── index.ts              # Entry point — routes HTTP to handlers
│   ├── handlers/
│   │   ├── slack.ts          # Slash command parser + routing
│   │   ├── cron.ts           # Daily job (shift change, reminders)
│   │   └── interactions.ts   # Button clicks, modal submissions
│   ├── services/
│   │   ├── notion.ts         # Notion API client (query/update shifts & constraints)
│   │   ├── slack.ts          # Slack API client (messages, modals, user group)
│   │   └── userMapping.ts    # Notion email → Slack user ID resolution
│   ├── types/
│   │   └── index.ts          # Shared types (Shift, Constraint, etc.)
│   └── config.ts             # Env vars, constants
├── deploy/
│   ├── deploy.sh             # Deploy Cloud Function
│   ├── setup-scheduler.sh    # Create Cloud Scheduler job
│   └── terraform/            # Optional: IaC for GCP resources
│       └── main.tf
├── docs/
│   ├── plans/
│   │   └── 2026-04-19-notion-oncaller-design.md
│   ├── SETUP.md              # Step-by-step setup guide
│   └── SLACK_APP_SETUP.md    # Slack app configuration guide
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── LICENSE                   # MIT
└── README.md                 # Project overview, features, quickstart
```

## Tech Stack

- **Runtime:** Node.js 20, TypeScript
- **Slack:** @slack/bolt, @slack/web-api
- **Notion:** @notionhq/client
- **GCP:** @google-cloud/functions-framework
- **Dates:** dayjs
- **Deploy:** gcloud CLI scripts + optional Terraform

## Environment Variables

```
NOTION_API_KEY=
NOTION_ONCALL_DB_ID=
NOTION_CONSTRAINTS_DB_ID=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_ONCALL_CHANNEL=
SLACK_ONCALL_USERGROUP_ID=
```

## Error Handling

- **Slack 3-second timeout:** Respond immediately with "Working on it...", post actual result async via response_url
- **Notion down:** Log error, skip. No partial state changes.
- **User not found:** Reply with helpful error about email mismatch
- **Switch expiry:** Auto-expire after 48h, notify requester
- **Atomic swaps:** Update both shifts in sequence, roll back if second fails
- **Status validation:** Only Scheduled → Active → Completed transitions allowed
- **Duplicate commands:** Idempotent responses

## Scope Boundaries

**In scope:**
- Slash commands (list, mine, now, switch, add-constraint, my-constraints, help)
- Daily cron (shift transitions, reminders, user group update)
- Constraints DB creation and management
- Deployment scripts, docs, open source packaging

**Out of scope (intentionally):**
- Auto-scheduling / rotation generation — schedule is built manually in Notion
- Caching layer — Notion is the only data store
- Web UI — Slack is the only interface
