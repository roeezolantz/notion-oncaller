# Changelog

## [Unreleased]

### Added
- `/oncall broadcast` — admin-gated subcommand that DMs every on-call team member with their own upcoming shifts. Two-step flow: anyone can run it to see an ephemeral preview; only members of `ONCALL_ADMINS` can hit Send. Each DM includes View Full Schedule, Request Replacement, and Request Swap buttons (the last two reuse the existing picker modals).
- `ONCALL_ADMINS` env var: comma-separated emails on the broadcast send allowlist.
- `BroadcastService` for building dry-run plans (pure data, no Slack I/O).
- `SlackService.respondToInteraction()` helper for replacing ephemeral messages via Slack `response_url`.

### Changed
- Extracted shift-picker modal construction (`buildReplacementPickerModal`, `buildSwapPickerModal`) onto `SlackService` so the slash commands and the new broadcast DM buttons share the same builder.

## [1.0.0] - 2026-04-21

### Added
- Daily cron job (9:30 AM) with shift transitions, @oncall group sync, and channel notifications
- DM reminders 1 day and 7 days before shifts
- `/oncall list` — view all upcoming shifts
- `/oncall mine` — view your shifts
- `/oncall now` — see who's on-call
- `/oncall replacement` — one-way shift coverage (someone takes your shift)
- `/oncall swap` — two-way proposal-based shift swap
- `/oncall block` — block out unavailable dates
- `/oncall my-blocks` — view your blocked dates
- `/oncall help` — command reference
- Slack signature verification (HMAC-SHA256)
- OIDC-authenticated cron endpoint
- Auto-activate missed shifts on daily sync
- Notion On-Call Constraints database for blocked dates
- View Schedule button linking to Notion
- Request Switch button on reminders
- Cancel button on replacement/swap requests
- Buttons disabled after action (no double-clicks)
- GCP deployment scripts (Cloud Function + Cloud Scheduler)
- Configurable timezone for scheduler
- Min instances = 1 for warm starts
