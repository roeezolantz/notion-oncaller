export interface Shift {
  id: string;
  name: string;
  personNotionId: string;
  personEmail: string;
  personName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  shiftType: 'Regular' | 'Backup Standby' | 'Backup Used' | 'Holiday';
  status: 'Scheduled' | 'Active' | 'Completed' | 'Cancelled';
}

export interface Constraint {
  id: string;
  personNotionId: string;
  personEmail: string;
  personName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Active' | 'Expired' | 'Cancelled';
}

export interface SlackUser {
  id: string;
  email: string;
  realName: string;
}
