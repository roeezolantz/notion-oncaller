import { NotionService } from '../notion';

// Mock the Notion client
jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    dataSources: {
      query: jest.fn(),
    },
    pages: {
      update: jest.fn(),
      create: jest.fn(),
    },
  })),
}));

function makeShiftPage(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'shift-1',
    properties: {
      Date: {
        title: [{ plain_text: overrides.name ?? 'Week 1' }],
      },
      'On-Call Person': {
        people: [
          {
            id: overrides.personNotionId ?? 'person-1',
            name: overrides.personName ?? 'Alice',
            person: { email: overrides.personEmail ?? 'alice@example.com' },
          },
        ],
      },
      'Shift Dates': {
        date: {
          start: overrides.startDate ?? '2026-04-20',
          end: overrides.endDate ?? '2026-04-27',
        },
      },
      'Shift Type': {
        select: { name: overrides.shiftType ?? 'Regular' },
      },
      Status: {
        status: { name: overrides.status ?? 'Scheduled' },
      },
    },
  };
}

function makeConstraintPage(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'constraint-1',
    properties: {
      Title: {
        title: [{ plain_text: overrides.title ?? 'Alice - Constraint' }],
      },
      Person: {
        people: [
          {
            id: overrides.personNotionId ?? 'person-1',
            name: overrides.personName ?? 'Alice',
            person: { email: overrides.personEmail ?? 'alice@example.com' },
          },
        ],
      },
      'Blackout Dates': {
        date: {
          start: overrides.startDate ?? '2026-05-01',
          end: overrides.endDate ?? '2026-05-07',
        },
      },
      Reason: {
        rich_text: [{ plain_text: overrides.reason ?? 'Vacation' }],
      },
      Status: {
        select: { name: overrides.status ?? 'Active' },
      },
    },
  };
}

describe('NotionService', () => {
  let service: NotionService;
  let mockClient: any;

  beforeEach(() => {
    service = new NotionService('test-api-key', 'oncall-db-id', 'constraints-db-id', 'constraints-page-id');
    // Access the internal client via the mock
    mockClient = (service as any).client;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --- parseShift ---

  describe('parseShift', () => {
    it('should parse a Notion page into a Shift', () => {
      const page = makeShiftPage();
      const shift = service.parseShift(page);
      expect(shift).toEqual({
        id: 'shift-1',
        name: 'Week 1',
        personNotionId: 'person-1',
        personEmail: 'alice@example.com',
        personName: 'Alice',
        startDate: '2026-04-20',
        endDate: '2026-04-27',
        shiftType: 'Regular',
        status: 'Scheduled',
      });
    });

    it('should handle missing fields gracefully', () => {
      const page = { id: 'empty', properties: {} };
      const shift = service.parseShift(page);
      expect(shift.id).toBe('empty');
      expect(shift.name).toBe('');
      expect(shift.personEmail).toBe('');
    });
  });

  // --- parseConstraint ---

  describe('parseConstraint', () => {
    it('should parse a Notion page into a Constraint', () => {
      const page = makeConstraintPage();
      const constraint = service.parseConstraint(page);
      expect(constraint).toEqual({
        id: 'constraint-1',
        personNotionId: 'person-1',
        personEmail: 'alice@example.com',
        personName: 'Alice',
        startDate: '2026-05-01',
        endDate: '2026-05-07',
        reason: 'Vacation',
        status: 'Active',
      });
    });
  });

  // --- getShiftsByDate ---

  describe('getShiftsByDate', () => {
    it('should query the oncall DB filtered by date', async () => {
      const page = makeShiftPage();
      mockClient.dataSources.query.mockResolvedValue({ results: [page] });

      const shifts = await service.getShiftsByDate('2026-04-20');

      expect(mockClient.dataSources.query).toHaveBeenCalledWith({
        data_source_id: 'oncall-db-id',
        filter: {
          property: 'Shift Dates',
          date: { equals: '2026-04-20' },
        },
      });
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startDate).toBe('2026-04-20');
    });
  });

  // --- getActiveShift ---

  describe('getActiveShift', () => {
    it('should return the active shift', async () => {
      const page = makeShiftPage({ status: 'Active' });
      mockClient.dataSources.query.mockResolvedValue({ results: [page] });

      const shift = await service.getActiveShift();

      expect(mockClient.dataSources.query).toHaveBeenCalledWith({
        data_source_id: 'oncall-db-id',
        filter: {
          property: 'Status',
          status: { equals: 'Active' },
        },
      });
      expect(shift).not.toBeNull();
      expect(shift!.status).toBe('Active');
    });

    it('should return null when no active shift exists', async () => {
      mockClient.dataSources.query.mockResolvedValue({ results: [] });

      const shift = await service.getActiveShift();
      expect(shift).toBeNull();
    });
  });

  // --- getUpcomingShifts ---

  describe('getUpcomingShifts', () => {
    it('should return scheduled shifts sorted ascending', async () => {
      const page1 = makeShiftPage({ id: 's1', startDate: '2026-04-20' });
      const page2 = makeShiftPage({ id: 's2', startDate: '2026-04-27' });
      mockClient.dataSources.query.mockResolvedValue({ results: [page1, page2] });

      const shifts = await service.getUpcomingShifts();

      expect(mockClient.dataSources.query).toHaveBeenCalledWith({
        data_source_id: 'oncall-db-id',
        filter: {
          property: 'Status',
          status: { equals: 'Scheduled' },
        },
        sorts: [
          { property: 'Shift Dates', direction: 'ascending' },
        ],
      });
      expect(shifts).toHaveLength(2);
    });
  });

  // --- getShiftsForPerson ---

  describe('getShiftsForPerson', () => {
    it('should filter Active+Scheduled shifts by email', async () => {
      const alicePage = makeShiftPage({ personEmail: 'alice@example.com', status: 'Active' });
      const bobPage = makeShiftPage({ id: 's2', personEmail: 'bob@example.com', status: 'Scheduled' });
      mockClient.dataSources.query.mockResolvedValue({ results: [alicePage, bobPage] });

      const shifts = await service.getShiftsForPerson('alice@example.com');

      expect(mockClient.dataSources.query).toHaveBeenCalledWith({
        data_source_id: 'oncall-db-id',
        filter: {
          or: [
            { property: 'Status', status: { equals: 'Active' } },
            { property: 'Status', status: { equals: 'Scheduled' } },
          ],
        },
      });
      expect(shifts).toHaveLength(1);
      expect(shifts[0].personEmail).toBe('alice@example.com');
    });

    it('should return empty array when no shifts match', async () => {
      mockClient.dataSources.query.mockResolvedValue({ results: [] });
      const shifts = await service.getShiftsForPerson('nobody@example.com');
      expect(shifts).toEqual([]);
    });
  });

  // --- updateShiftStatus ---

  describe('updateShiftStatus', () => {
    it('should update the status of a shift page', async () => {
      mockClient.pages.update.mockResolvedValue({});

      await service.updateShiftStatus('shift-1', 'Active');

      expect(mockClient.pages.update).toHaveBeenCalledWith({
        page_id: 'shift-1',
        properties: {
          Status: {
            status: { name: 'Active' },
          },
        },
      });
    });
  });

  // --- swapShiftPersons ---

  describe('swapShiftPersons', () => {
    it('should swap persons between two shifts', async () => {
      mockClient.pages.update.mockResolvedValue({});

      await service.swapShiftPersons('shift-a', 'person-a', 'shift-b', 'person-b');

      expect(mockClient.pages.update).toHaveBeenCalledTimes(2);
      // First call: shift A gets person B
      expect(mockClient.pages.update).toHaveBeenNthCalledWith(1, {
        page_id: 'shift-a',
        properties: {
          'On-Call Person': { people: [{ id: 'person-b' }] },
        },
      });
      // Second call: shift B gets person A
      expect(mockClient.pages.update).toHaveBeenNthCalledWith(2, {
        page_id: 'shift-b',
        properties: {
          'On-Call Person': { people: [{ id: 'person-a' }] },
        },
      });
    });

    it('should rollback shift A if updating shift B fails', async () => {
      mockClient.pages.update
        .mockResolvedValueOnce({}) // shift A succeeds
        .mockRejectedValueOnce(new Error('Notion API error')) // shift B fails
        .mockResolvedValueOnce({}); // rollback succeeds

      await expect(
        service.swapShiftPersons('shift-a', 'person-a', 'shift-b', 'person-b'),
      ).rejects.toThrow('Notion API error');

      expect(mockClient.pages.update).toHaveBeenCalledTimes(3);
      // Third call: rollback shift A back to person A
      expect(mockClient.pages.update).toHaveBeenNthCalledWith(3, {
        page_id: 'shift-a',
        properties: {
          'On-Call Person': { people: [{ id: 'person-a' }] },
        },
      });
    });
  });

  // --- createConstraint ---

  describe('createConstraint', () => {
    it('should create a constraint page in the constraints DB', async () => {
      mockClient.pages.create.mockResolvedValue({});

      await service.createConstraint('person-1', 'Alice', '2026-05-01', '2026-05-07', 'Vacation');

      expect(mockClient.pages.create).toHaveBeenCalledWith({
        parent: { database_id: 'constraints-page-id' },
        properties: {
          Title: {
            title: [{ text: { content: 'Alice - Constraint' } }],
          },
          Person: {
            people: [{ id: 'person-1' }],
          },
          'Blackout Dates': {
            date: { start: '2026-05-01', end: '2026-05-07' },
          },
          Reason: {
            rich_text: [{ text: { content: 'Vacation' } }],
          },
          Status: {
            select: { name: 'Active' },
          },
        },
      });
    });
  });

  // --- getConstraintsForPerson ---

  describe('getConstraintsForPerson', () => {
    it('should return constraints filtered by person email', async () => {
      const aliceConstraint = makeConstraintPage({ personEmail: 'alice@example.com' });
      const bobConstraint = makeConstraintPage({ id: 'c2', personEmail: 'bob@example.com' });
      mockClient.dataSources.query.mockResolvedValue({ results: [aliceConstraint, bobConstraint] });

      const constraints = await service.getConstraintsForPerson('alice@example.com');

      expect(constraints).toHaveLength(1);
      expect(constraints[0].personEmail).toBe('alice@example.com');
    });
  });

  // --- getOverlappingShifts ---

  describe('getOverlappingShifts', () => {
    it('should return shifts that overlap the given date range', async () => {
      const overlapping = makeShiftPage({
        id: 's1',
        personEmail: 'alice@example.com',
        startDate: '2026-04-25',
        endDate: '2026-05-02',
        status: 'Scheduled',
      });
      const nonOverlapping = makeShiftPage({
        id: 's2',
        personEmail: 'alice@example.com',
        startDate: '2026-05-10',
        endDate: '2026-05-17',
        status: 'Scheduled',
      });
      mockClient.dataSources.query.mockResolvedValue({ results: [overlapping, nonOverlapping] });

      const result = await service.getOverlappingShifts('alice@example.com', '2026-05-01', '2026-05-07');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s1');
    });

    it('should return empty array when no shifts overlap', async () => {
      const shift = makeShiftPage({
        personEmail: 'alice@example.com',
        startDate: '2026-06-01',
        endDate: '2026-06-08',
        status: 'Active',
      });
      mockClient.dataSources.query.mockResolvedValue({ results: [shift] });

      const result = await service.getOverlappingShifts('alice@example.com', '2026-05-01', '2026-05-07');
      expect(result).toEqual([]);
    });
  });
});
