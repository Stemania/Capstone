export type DowntimeCategory =
  | 'MECHANICAL_FAILURE'
  | 'ELECTRICAL_FAULT'
  | 'UNDER_REPAIR'
  | 'WAITING_FOR_PARTS'
  | 'SCHEDULED_MAINTENANCE'
  | 'OTHER';

export const DOWNTIME_REASONS: { value: DowntimeCategory; label: string }[] = [
  { value: 'MECHANICAL_FAILURE', label: 'Mechanical failure' },
  { value: 'ELECTRICAL_FAULT', label: 'Electrical fault' },
  { value: 'UNDER_REPAIR', label: 'Under repair' },
  { value: 'WAITING_FOR_PARTS', label: 'Waiting for parts' },
  { value: 'SCHEDULED_MAINTENANCE', label: 'Scheduled maintenance' },
  { value: 'OTHER', label: 'Other' },
];
