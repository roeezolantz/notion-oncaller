# Changelog

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
