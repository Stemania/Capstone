type Sortable = {
  dueDate?: string | null;
  poDate?: string | null;
  createdAt?: string | null;
};

const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

/** Due date first; jobs due the same day go by client PO date (none last), then by when they were created. */
export function compareByDue(a: Sortable, b: Sortable): number {
  return (
    time(a.dueDate?.slice(0, 10)) - time(b.dueDate?.slice(0, 10)) ||
    time(a.poDate) - time(b.poDate) ||
    time(a.createdAt) - time(b.createdAt)
  );
}

const FINISHED = new Set(['DELIVERED', 'CANCELLED']);

/**
 * Default list order: open work first by due date (soonest first); delivered
 * and cancelled jobs after it, the most recently due first, so old finished
 * jobs do not sit at the top.
 */
export function compareOpenFirst(a: Sortable & { status?: string }, b: Sortable & { status?: string }): number {
  const fa = FINISHED.has(a.status || '') ? 1 : 0;
  const fb = FINISHED.has(b.status || '') ? 1 : 0;
  if (fa !== fb) return fa - fb;
  return fa ? compareByDue(b, a) : compareByDue(a, b);
}
