# Slack App Setup

## Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name: "On-Call Bot", pick your workspace

## Configure Slash Command

1. Go to **Slash Commands** > **Create New Command**
2. Command: `/oncall`
3. Request URL: `https://YOUR_FUNCTION_URL/slack/commands`
4. Short Description: "Manage on-call shifts"
5. Usage Hint: `list | mine | now | switch | add-constraint | my-constraints | help`

## Configure Interactivity

1. Go to **Interactivity & Shortcuts** > Enable
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

1. Go to **Install App** > **Install to Workspace**
2. Copy **Bot User OAuth Token** — `SLACK_BOT_TOKEN`
3. Go to **Basic Information** > **App Credentials**
4. Copy **Signing Secret** — `SLACK_SIGNING_SECRET`

## Get Channel and User Group IDs

**Channel ID:**
- Right-click the channel in Slack > "View channel details"
- Copy the Channel ID at the bottom — `SLACK_ONCALL_CHANNEL`

**User Group ID (@oncall):**
- Use Slack API: `usergroups.list` > find @oncall > copy ID — `SLACK_ONCALL_USERGROUP_ID`
