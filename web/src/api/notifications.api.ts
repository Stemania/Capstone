import apiClient from './client';
import type { NotificationLog } from '../types';

export const notificationsApi = {
  list: (params?: { jobOrderId?: string; clientId?: string; status?: string; limit?: number }) =>
    apiClient.get<NotificationLog[]>('/notifications', { params }),
  resend: (id: string) => apiClient.post<NotificationLog>(`/notifications/${id}/resend`),
};
