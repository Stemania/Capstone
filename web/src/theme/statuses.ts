import type { Tone } from './tokens';

/**
 * The one status → colour map. Every pill, bar, dot and legend reads from
 * here, so a status looks the same on every screen. Words always go with the
 * colour; colour is never the only signal.
 */
export type StatusDef = { label: string; tone: Tone };

export const JOB_STATUS: Record<string, StatusDef> = {
  DRAFT: { label: 'To plan', tone: 'slate' },
  SCHEDULED: { label: 'Scheduled', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'indigo' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  DELIVERED: { label: 'For Delivery', tone: 'teal' },
};

export const OPERATION_STATUS: Record<string, StatusDef> = {
  PENDING: { label: 'Pending', tone: 'slate' },
  SCHEDULED: { label: 'Scheduled', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'indigo' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  REWORK: { label: 'Redo', tone: 'amber' },
};

/** Flags that sit on top of a job's stage. */
export const JOB_FLAG = {
  overdue: { label: 'Overdue', tone: 'red' },
  needsReplan: { label: 'Needs re-plan', tone: 'red' },
  waitingForMaterials: { label: 'Waiting for materials', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
} as const satisfies Record<string, StatusDef>;

export const SUPPLIER_ORDER_STATUS: Record<string, StatusDef> = {
  DRAFT: { label: 'Draft', tone: 'slate' },
  ISSUED: { label: 'Issued', tone: 'blue' },
  // Kept for legacy DB rows; new code never writes this status.
  PARTIALLY_RECEIVED: { label: 'Issued', tone: 'blue' },
  RECEIVED: { label: 'Received', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'grey' },
};

export const ATTENDANCE_STATUS: Record<string, StatusDef> = {
  PRESENT: { label: 'Present', tone: 'green' },
  CLOCKED_IN: { label: 'Still clocked in', tone: 'blue' },
  LATE: { label: 'Late', tone: 'amber' },
  INCOMPLETE: { label: 'Incomplete', tone: 'amber' },
  ABSENT: { label: 'Absent', tone: 'red' },
  NOT_IN: { label: 'Not in yet', tone: 'red' },
  NOT_YET: { label: 'Not yet', tone: 'slate' },
  OFF: { label: 'Day off', tone: 'grey' },
};

export const STOCK_STATUS = {
  IN_STOCK: { label: 'In stock', tone: 'green' },
  LOW: { label: 'Low', tone: 'amber' },
  OUT: { label: 'Out', tone: 'red' },
} as const satisfies Record<string, StatusDef>;

export const MACHINE_STATUS: Record<string, StatusDef> = {
  running: { label: 'Running', tone: 'green' },
  idle: { label: 'Idle', tone: 'slate' },
  breakdown: { label: 'Breakdown', tone: 'red' },
  retired: { label: 'Removed', tone: 'grey' },
};

export const USER_STATUS: Record<string, StatusDef> = {
  ACTIVE: { label: 'Active', tone: 'green' },
  INVITED: { label: 'Invited', tone: 'amber' },
  DISABLED: { label: 'Disabled', tone: 'grey' },
};

export const ROLE_TONE: Record<string, Tone> = {
  ADMIN: 'indigo',
  OFFICE_STAFF: 'amber',
  PRODUCTION_WORKER: 'teal',
};

export const TOOL_UNIT_STATUS: Record<string, StatusDef> = {
  AVAILABLE: { label: 'Available', tone: 'green' },
  OUT: { label: 'Out', tone: 'blue' },
  UNDER_REPAIR: { label: 'Under repair', tone: 'amber' },
  RETIRED: { label: 'Retired', tone: 'grey' },
};

/** Schedule finish against the date required. */
export const SCHEDULE_FLAG_TONE: Record<string, Tone> = {
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
};

/** Bar fills that keep white 12px text at WCAG AA (4.5:1). */
export const TONE_BAR_FILL: Record<Tone, string> = {
  slate: '#64748b',
  blue: '#2563eb',
  indigo: '#4f46e5',
  green: '#15803d',
  teal: '#0f766e',
  amber: '#b45309',
  red: '#b91c1c',
  grey: '#71717a',
};

/** Gantt bar fill per operation status, from OPERATION_STATUS. */
export const OPERATION_BAR_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(OPERATION_STATUS).map(([k, d]) => [k, TONE_BAR_FILL[d.tone]]),
);

export function statusDef(map: Record<string, StatusDef>, code: string | null | undefined): StatusDef {
  return (code && map[code]) || { label: code ? code.replace(/_/g, ' ').toLowerCase() : '—', tone: 'slate' };
}
