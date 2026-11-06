import apiClient from './client';
import type { NotificationLog } from '../types';

export const notificationsApi = {
  list: (params?: { jobOrderId?: string; clientId?: string; status?: string; limit?: number }) =>
    apiClient.get<NotificationLog[]>('/notifications', { params }),
  /** Admin only. Respects NOTIFICATIONS_ENABLED and NOTIFY_ALLOWLIST; returns the log row. */
  sendTest: (channel: 'email', to: string) =>
    apiClient.post<NotificationLog>('/admin/notifications/test', { channel, to }),
};
