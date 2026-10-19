/** Day-to-day Job Orders tabs. Archive is a separate page, not a tab. */
export const JOB_ORDER_LIST_TABS = ['production', 'drafts', 'assigned'] as const;

export type JobOrderListTab = (typeof JOB_ORDER_LIST_TABS)[number];

export function isJobOrderListTab(value: string | null | undefined): value is JobOrderListTab {
  return value === 'production' || value === 'drafts' || value === 'assigned';
}

/** Materials radios on create/edit; labels must stay short and horizontal. */
export const MATERIALS_NEEDED_OPTIONS = [
  { value: 'TO_ORDER', label: 'To order' },
  { value: 'NOT_REQUIRED', label: 'Not required' },
] as const;
