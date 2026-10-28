import apiClient from './client';
import type { AuditLogOptions, AuditLogPage, AuditEntry } from '../types';

export type AuditLogQuery = {
  page?: number;
  pageSize?: number;
  category?: string;
  userId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  q?: string;
};

/** The audit trail. Admin only; entries can be read, never changed. */
export const auditApi = {
  list: (params: AuditLogQuery) => apiClient.get<AuditLogPage>('/admin/audit-logs', { params }),
  options: () => apiClient.get<AuditLogOptions>('/admin/audit-logs/options'),
  jobHistory: (jobId: string) =>
    apiClient.get<{ items: AuditEntry[] }>(`/admin/audit-logs/job-orders/${jobId}`),
};
