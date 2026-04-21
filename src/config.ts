export const config = {
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    oncallDbId: process.env.NOTION_ONCALL_DB_ID || '',
    constraintsDbId: process.env.NOTION_CONSTRAINTS_DB_ID || '',
    constraintsPageId: process.env.NOTION_CONSTRAINTS_PAGE_ID || '',
    scheduleUrl: process.env.NOTION_SCHEDULE_URL || 'https://www.notion.so/fhenix/3478471c7c228067a881e566217b2688',
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
