export const HISTORY_PAGE_SIZE = 5;

/** "1–5 of 27" for the small history and tool pagers. */
export function historyRangeLabel(total: number, page: number, pageSize = HISTORY_PAGE_SIZE): string {
  if (total <= 0) return '';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `${start}–${end} of ${total}`;
}
