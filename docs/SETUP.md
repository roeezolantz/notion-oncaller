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
4. Copy the **Internal Integration Secret** — this is your `NOTION_API_KEY`

### Share Databases

1. Open your On-Call Schedule database in Notion
2. Click "..." > "Connections" > Add your integration
3. Copy the database ID from the URL — `NOTION_ONCALL_DB_ID`

### Create Constraints Database

```bash
NOTION_API_KEY=your_key NOTION_PARENT_PAGE_ID=your_page_id npx ts-node deploy/setup-constraints-db.ts
```

Copy the output database ID — `NOTION_CONSTRAINTS_DB_ID`

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
3. Check GCP Console > Cloud Scheduler to verify the daily job
