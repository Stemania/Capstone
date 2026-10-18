import apiClient from './client';
import type { NotificationLog } from '../types';

export const notificationsApi = {
  list: (params?: { jobOrderId?: string; clientId?: string; status?: string; limit?: number }) =>
    apiClient.get<NotificationLog[]>('/notifications', { params }),
  resend: (id: string) => apiClient.post<NotificationLog>(`/notifications/${id}/resend`),
  /** Admin only. Respects NOTIFICATIONS_ENABLED and NOTIFY_ALLOWLIST; returns the log row. */
  sendTest: (channel: 'email', to: string) =>
    apiClient.post<NotificationLog>('/admin/notifications/test', { channel, to }),
};
