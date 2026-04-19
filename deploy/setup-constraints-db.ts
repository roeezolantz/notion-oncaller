import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function createConstraintsDb() {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    console.error('Set NOTION_PARENT_PAGE_ID to the OnCall Shifts Space page ID');
    process.exit(1);
  }

  const response = await (notion as any).databases.create({
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'On-Call Constraints' } }],
    properties: {
      Title: { title: {} },
      Person: { people: {} },
      'Blackout Dates': { date: {} },
      Reason: { rich_text: {} },
      Status: {
        select: {
          options: [
            { name: 'Active', color: 'green' },
            { name: 'Expired', color: 'gray' },
            { name: 'Cancelled', color: 'red' },
          ],
        },
      },
    },
  });

  console.log('Constraints DB created!');
  console.log('Database ID:', response.id);
  console.log('Add this to your .env as NOTION_CONSTRAINTS_DB_ID');
}

createConstraintsDb().catch(console.error);
