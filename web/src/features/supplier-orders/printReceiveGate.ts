/** Receive stays disabled until the PO has been printed at least once. */
export const PRINT_BEFORE_RECEIVE_HINT =
  'Print the PO first — the supplier needs the printed copy.';

export function canReceiveOrder(printedAt: string | null | undefined): boolean {
  return Boolean(printedAt);
}

/** Detail-page printed status line. */
export function printedStatusLabel(
  printedAt: string | null | undefined,
  printedByName: string | null | undefined,
  formatDay: (iso: string | null | undefined) => string
): string {
  if (!printedAt) return 'Not printed yet';
  const when = formatDay(printedAt);
  return printedByName ? `Printed ${when} by ${printedByName}` : `Printed ${when}`;
}
