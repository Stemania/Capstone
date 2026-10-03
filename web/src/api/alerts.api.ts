import apiClient from './client';
import type { StaffAlert } from '../types';

export const alertsApi = {
  list: () => apiClient.get<{ items: StaffAlert[]; unreadCount: number }>('/alerts'),
  unreadCount: () => apiClient.get<{ unreadCount: number }>('/alerts/unread-count'),
  markRead: (id: string) => apiClient.post<StaffAlert>(`/alerts/${id}/read`),
  markAllRead: () => apiClient.post<{ marked: number }>('/alerts/read-all'),
};
