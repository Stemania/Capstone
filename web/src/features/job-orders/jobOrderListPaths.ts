/** List URL helpers — keep draft exits on the Drafts tab. */

export function jobOrdersListPath(status?: string | null): string {
  return status === 'DRAFT' ? '/job-orders?tab=drafts' : '/job-orders';
}

export function jobOrdersDraftsListPath(): string {
  return '/job-orders?tab=drafts';
}
