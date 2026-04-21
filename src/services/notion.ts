import { Client } from '@notionhq/client';
import { Shift, Constraint } from '../types';

export class NotionService {
  private client: any;
  private oncallDbId: string;
  private constraintsDbId: string;
  private constraintsPageId: string;

  constructor(apiKey: string, oncallDbId: string, constraintsDbId: string, constraintsPageId: string) {
    this.client = new Client({ auth: apiKey });
    this.oncallDbId = oncallDbId;
    this.constraintsDbId = constraintsDbId;
    this.constraintsPageId = constraintsPageId;
  }

  // --- Shifts ---

  async getShiftsByDate(date: string): Promise<Shift[]> {
    console.log(`Querying shifts for date: ${date}, data_source_id: ${this.oncallDbId}`);
    const response = await this.client.dataSources.query({
      data_source_id: this.oncallDbId,
      filter: {
        property: 'Shift Dates',
        date: {
          equals: date,
        },
      },
    });
    console.log(`Found ${response.results.length} shifts for ${date}`);
    return response.results.map((page: any) => this.parseShift(page));
  }

  async getActiveShift(): Promise<Shift | null> {
    const response = await this.client.dataSources.query({
      data_source_id: this.oncallDbId,
      filter: {
        property: 'Status',
        status: {
          equals: 'Active',
        },
      },
    });
    if (response.results.length === 0) return null;
    return this.parseShift(response.results[0] as any);
  }

  async getUpcomingShifts(): Promise<Shift[]> {
    const response = await this.client.dataSources.query({
      data_source_id: this.oncallDbId,
      filter: {
        property: 'Status',
        status: {
          equals: 'Scheduled',
        },
      },
      sorts: [
        {
          property: 'Shift Dates',
          direction: 'ascending',
        },
      ],
    });
    return response.results.map((page: any) => this.parseShift(page));
  }

  async getShiftsForPerson(email: string): Promise<Shift[]> {
    const response = await this.client.dataSources.query({
      data_source_id: this.oncallDbId,
      filter: {
        or: [
          {
            property: 'Status',
            status: { equals: 'Active' },
          },
          {
            property: 'Status',
            status: { equals: 'Scheduled' },
          },
        ],
      },
    });
    const shifts = response.results.map((page: any) => this.parseShift(page));
    return shifts.filter((s: Shift) => s.personEmail === email);
  }

  async updateShiftStatus(pageId: string, status: string): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        Status: {
          status: {
            name: status,
          },
        },
      } as any,
    });
  }

  async swapShiftPersons(
    shiftAId: string,
    personAId: string,
    shiftBId: string,
    personBId: string,
  ): Promise<void> {
    // Update shift A to have person B
    await this.client.pages.update({
      page_id: shiftAId,
      properties: {
        'On-Call Person': {
          people: [{ id: personBId }],
        },
      } as any,
    });

    try {
      // Update shift B to have person A
      await this.client.pages.update({
        page_id: shiftBId,
        properties: {
          'On-Call Person': {
            people: [{ id: personAId }],
          },
        } as any,
      });
    } catch (error) {
      // Rollback shift A back to person A
      await this.client.pages.update({
        page_id: shiftAId,
        properties: {
          'On-Call Person': {
            people: [{ id: personAId }],
          },
        } as any,
      });
      throw error;
    }
  }

  // --- Constraints ---

  async createConstraint(
    personNotionId: string,
    personName: string,
    startDate: string,
    endDate: string,
    reason: string,
  ): Promise<void> {
    await this.client.pages.create({
      parent: { database_id: this.constraintsPageId },
      properties: {
        Title: {
          title: [
            {
              text: { content: `${personName} - Constraint` },
            },
          ],
        },
        Person: {
          people: [{ id: personNotionId }],
        },
        'Blackout Dates': {
          date: {
            start: startDate,
            end: endDate,
          },
        },
        Reason: {
          rich_text: [
            {
              text: { content: reason },
            },
          ],
        },
        Status: {
          select: {
            name: 'Active',
          },
        },
      } as any,
    });
  }

  async getConstraintsForPerson(email: string): Promise<Constraint[]> {
    const response = await this.client.dataSources.query({
      data_source_id: this.constraintsDbId,
    });
    const constraints = response.results.map((page: any) => this.parseConstraint(page));
    return constraints.filter((c: Constraint) => c.personEmail === email);
  }

  async getOverlappingShifts(
    email: string,
    startDate: string,
    endDate: string,
  ): Promise<Shift[]> {
    const shifts = await this.getShiftsForPerson(email);
    return shifts.filter(
      (s) => s.startDate < endDate && s.endDate > startDate,
    );
  }

  // --- Parsers ---

  parseShift(page: any): Shift {
    const props = page.properties;
    const person = props['On-Call Person']?.people?.[0];
    return {
      id: page.id,
      name: props['Date']?.title?.[0]?.plain_text ?? '',
      personNotionId: person?.id ?? '',
      personEmail: person?.person?.email ?? '',
      personName: person?.name ?? '',
      startDate: props['Shift Dates']?.date?.start ?? '',
      endDate: props['Shift Dates']?.date?.end ?? '',
      shiftType: props['Shift Type']?.select?.name ?? 'Regular',
      status: props['Status']?.status?.name ?? 'Scheduled',
    };
  }

  parseConstraint(page: any): Constraint {
    const props = page.properties;
    const person = props['Person']?.people?.[0];
    return {
      id: page.id,
      personNotionId: person?.id ?? '',
      personEmail: person?.person?.email ?? '',
      personName: person?.name ?? '',
      startDate: props['Blackout Dates']?.date?.start ?? '',
      endDate: props['Blackout Dates']?.date?.end ?? '',
      reason: props['Reason']?.rich_text?.[0]?.plain_text ?? '',
      status: props['Status']?.select?.name ?? 'Active',
    };
  }
}
