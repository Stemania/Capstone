/** Hours as "2h 15m" (or "40m", "0m"), rounded to the nearest minute. */
export function formatHoursMinutes(hours: number | null | undefined): string {
  if (hours == null || Number.isNaN(Number(hours))) return '—';
  const totalMin = Math.max(0, Math.round(Number(hours) * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
