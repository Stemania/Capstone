/** Job-order print always returns to the job list, whatever opened the printout. */
export function jobPrintBackPath(): string {
  return '/job-orders';
}
