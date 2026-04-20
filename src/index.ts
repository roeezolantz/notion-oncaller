import crypto from 'crypto';
import { http } from '@google-cloud/functions-framework';
import { WebClient } from '@slack/web-api';
import { config } from './config';
import { NotionService } from './services/notion';
import { SlackService } from './services/slack';
import { UserMappingService } from './services/userMapping';
import { CronHandler } from './handlers/cron';
import { SlackCommandHandler } from './handlers/slack';
import { InteractionHandler } from './handlers/interactions';

const slackClient = new WebClient(config.slack.botToken);
const notion = new NotionService(
  config.notion.apiKey,
  config.notion.oncallDbId,
  config.notion.constraintsDbId,
);
const slack = new SlackService(
  slackClient,
  config.slack.oncallChannel,
  config.slack.oncallUsergroupId,
);
const userMapping = new UserMappingService(slackClient);

const cronHandler = new CronHandler(notion, slack, userMapping);
const commandHandler = new SlackCommandHandler(notion, slack, userMapping);
const interactionHandler = new InteractionHandler(notion, slack, userMapping);

export function routeRequest(path: string, method: string): string {
  if (method === 'GET' && path === '/') return 'health';
  if (method === 'POST' && path === '/cron/daily') return 'cron';
  if (method === 'POST' && path === '/slack/commands') return 'slash_command';
  if (method === 'POST' && path === '/slack/interactions') return 'interaction';
  return 'not_found';
}

export function verifySlackRequest(req: any): boolean {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature =
    'v0=' +
    crypto
      .createHmac('sha256', config.slack.signingSecret)
      .update(sigBasestring)
      .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature),
  );
}

export function verifyCronRequest(req: any): boolean {
  const secret = req.headers['x-cron-secret'] || req.query?.secret;
  return secret === config.cron.secret;
}

function parseBody(req: any): any {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return req.body;
    }
  }
  return req.body || {};
}

http('app', async (req, res) => {
  const route = routeRequest(req.path, req.method);

  switch (route) {
    case 'health': {
      res.status(200).json({ status: 'ok', service: 'notion-oncaller' });
      return;
    }

    case 'cron': {
      // Auth handled by GCP IAM (OIDC token from Cloud Scheduler)
      try {
        await cronHandler.handleDaily();
        res.status(200).json({ status: 'ok' });
      } catch (err) {
        console.error('Cron handler error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
      return;
    }

    case 'slash_command': {
      if (!verifySlackRequest(req)) {
        res.status(401).json({ error: 'Invalid Slack signature' });
        return;
      }
      try {
        const body = parseBody(req);
        const response = await commandHandler.handle(body);
        res.status(200).json(response);
      } catch (err) {
        console.error('Slash command handler error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
      return;
    }

    case 'interaction': {
      if (!verifySlackRequest(req)) {
        res.status(401).json({ error: 'Invalid Slack signature' });
        return;
      }

      // Acknowledge immediately
      res.status(200).send('');

      try {
        const body = parseBody(req);
        const payload =
          typeof body.payload === 'string'
            ? JSON.parse(body.payload)
            : body.payload || body;

        if (payload.type === 'block_actions') {
          await interactionHandler.handleBlockAction(payload);
        } else if (payload.type === 'view_submission') {
          await interactionHandler.handleViewSubmission(payload);
        }
      } catch (err) {
        console.error('Interaction handler error:', err);
      }
      return;
    }

    default: {
      res.status(404).json({ error: 'Not found' });
      return;
    }
  }
});
