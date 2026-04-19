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
Slack ──HTTP──> GCP Cloud Function ──API──> Notion
                      ^
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
