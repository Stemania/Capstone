export const DOWNTIME_REASONS = [
  'Mechanical failure',
  'Electrical fault',
  'Under repair',
  'Waiting for parts',
  'Scheduled maintenance',
  'Other',
] as const;

export type DowntimeReason = (typeof DOWNTIME_REASONS)[number];
