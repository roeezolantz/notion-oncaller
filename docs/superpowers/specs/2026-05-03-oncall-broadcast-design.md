# `/oncall broadcast` — design

Date: 2026-05-03
Status: approved
Branch: `feat/oncall-broadcast`

## Summary

Add an admin-gated Slack subcommand that DMs every on-call team member their
own upcoming shifts with action buttons to view the schedule, request a
replacement, or request a swap.

## Motivation

Today, individual reminders fire 1 day and 7 days before each shift. There's
no way to send the team a single, intentional "here's what your future looks
like — please double-check it" nudge after schedule changes. The schedule
owner currently has to ping people one by one.

## User-facing behavior

- `/oncall broadcast` — opens an ephemeral preview to the invoker showing,
  per recipient, the list of shifts that would be DM'd.
- **Admins** see `[Send] [Cancel]` buttons under the preview.
- **Non-admins** see the same preview but no Send button, with an italic
  note: _"Only on-call admins can send broadcasts. Ask one of them to run
  this if it looks right."_
- On Send, the plan is **rebuilt against current Notion state** (the preview
  is a dry run) and DMs are sent. The ephemeral message is replaced with a
  result line.

## Recipient DM contents

```
:calendar_spiral: *Here's your updated on-call schedule — please make sure
to remember.*

• 2026-05-04 → 2026-05-11
• 2026-06-15 → 2026-06-22

[📅 View Full Schedule]   [🔁 Request Replacement]   [🤝 Request Swap]
```

- Bulleted date ranges, sorted ascending by `startDate`.
- `View Full Schedule` links to `NOTION_SCHEDULE_URL`.
- `Request Replacement` and `Request Swap` open the same modals as the
  existing `/oncall replacement` and `/oncall swap` slash commands. The
  picker-modal logic is extracted into helpers shared by both entry points.

## Recipient selection

- Source: `NotionService.getUpcomingShifts()` (existing).
- Group by person.
- Skip a person when:
  - they have no `Scheduled` upcoming shifts (`no_upcoming_shifts`), or
  - their email has no Slack mapping (`no_slack_mapping`).
- Skipped people appear in the preview under "Skipped:" with the reason.

## Permissions

- Admin allowlist via `ONCALL_ADMINS` env var: comma-separated emails,
  matched against the invoker's email (resolved via the existing
  `userMapping.getEmailBySlackId`).
- Email-based, not Slack-ID-based, to match how identity is keyed elsewhere
  in this codebase (Notion is the source of truth, keyed by email).
- Admin check happens twice: once at preview render time (to decide whether
  to render the Send button), once at Send time (defense in depth).

## Architecture

```
[invoker] /oncall broadcast
   ↓ (handlers/slack.ts → handleBroadcast)
   admin? = ONCALL_ADMINS contains invoker email
   plan   = BroadcastService.buildPlan()
   ↓
[ephemeral preview] preview blocks (Send button only if admin)
   ↓ (handlers/interactions.ts → handleBroadcastSend)
   admin re-check
   plan = BroadcastService.buildPlan()        // fresh — dry-run semantics
   for r in plan.recipients: SlackService.sendDM(r)
   ↓
[response_url update] "Sent to N. Skipped M. Failed K."
```

### New units

- `src/services/broadcast.ts` — `BroadcastService.buildPlan()` returns
  `BroadcastPlan = { recipients, skipped }`. Pure data, no Slack I/O. Fully
  unit-testable with mocked Notion + UserMapping.
- `SlackService.buildBroadcastDMBlocks(recipient, scheduleUrl)` — per-person
  DM blocks.
- `SlackService.buildBroadcastPreviewBlocks(plan, isAdmin)` — preview blocks
  with conditional Send/Cancel buttons.
- `SlackService.respondToInteraction(responseUrl, body)` — small helper that
  POSTs to a Slack `response_url`, used for replacing the preview after
  Send/Cancel.
- `SlackCommandHandler.handleBroadcast(payload)` — slash command entry.
- `InteractionHandler` cases:
  - `broadcast_send` → re-check admin, re-build plan, send DMs, replace
    ephemeral with result.
  - `broadcast_cancel` → replace ephemeral with `_Broadcast cancelled._`
  - `broadcast_request_replacement` / `broadcast_request_swap` → open the
    existing picker modals via shared helpers.

### Shared picker helpers

`handleReplacement` and `handleSwap` in `handlers/slack.ts` build picker
modals from the invoker's upcoming shifts. The modal-construction logic is
extracted into two helpers (`openReplacementPicker`, `openSwapPicker`) that
both the slash commands and the new DM buttons call. No behavior change to
the existing slash commands.

### Why rebuild on Send

Preview = dry run. The schedule may change between preview and send (rarely,
but possible). "Send the current state" is the right semantic, and it
sidesteps Slack's ~2000-char button-value limit. The Send button's value is
just `{ "kind": "broadcast_send" }`.

## Config

```ts
broadcast: {
  admins: (process.env.ONCALL_ADMINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
}
```

`.env.example` and README are updated to document `ONCALL_ADMINS`.

## Error handling

- **Empty plan** (nobody has upcoming shifts): preview shows
  "No one has upcoming shifts — nothing to broadcast." Send button hidden.
- **Some skipped**: listed with reason in preview; admin can still Send to
  the rest.
- **Per-DM send failure**: caught in the loop, logged, counted. Final
  message: `Sent to N. Skipped M. Failed K (see logs).` Loop continues.
- **Non-admin clicks Send** (e.g., button forwarded): ephemeral error
  `Only on-call admins can send broadcasts.`
- **Invoker has no email mapping**: same error path as `/oncall mine`.

## Testing

- `services/__tests__/broadcast.test.ts` — happy path, no-mapping skip,
  no-shifts skip, sort order, empty plan, non-Scheduled status filtered.
- `services/__tests__/slack.test.ts` — block builders produce the expected
  shapes; admin-vs-non-admin preview differs in the actions block; empty
  plan branch; `respondToInteraction` calls `axios.post` with the right URL.
- `handlers/__tests__/slack.test.ts` — `handleBroadcast` returns admin
  preview when invoker is in allowlist; non-admin preview otherwise; no
  email mapping → error; admin set is case-insensitive.
- `handlers/__tests__/interactions.test.ts` — `broadcast_send` re-checks
  admin and rebuilds the plan; `broadcast_cancel` replaces with cancellation
  message; `broadcast_request_replacement` / `broadcast_request_swap` open
  the same modals as the slash commands.

## Out of scope

- Scheduling broadcasts on a recurring cron. Add later if useful.
- Per-shift action buttons in the DM. Top-level buttons only — picker modal
  handles which shift.
- Audit log of who broadcasted when. Cloud Run stdout already captures it.
