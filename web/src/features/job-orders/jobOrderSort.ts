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
