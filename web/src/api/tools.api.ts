import apiClient from './client';
import type { Tool, ToolEvent } from '../types';

export const toolsApi = {
  list: () => apiClient.get<Tool[]>('/tools'),
  create: (data: { name: string; code?: string }) =>
    apiClient.post<Tool>('/tools', data),
  get: (id: string) => apiClient.get<Tool>(`/tools/${id}`),
  getQrUrl: (id: string) => `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/tools/${id}/qr`,
  scan: (code: string, jobOrderId?: string) =>
    apiClient.post<ToolEvent>('/tools/scan', { code, jobOrderId }),
  myTools: () =>
    apiClient.get<{ id: string; name: string; code: string; since: string }[]>('/tools/my'),
  listEvents: (params?: { toolId?: string; page?: number; perPage?: number }) =>
    apiClient.get<{ items: ToolEvent[]; total: number; page: number; pages: number }>(
      '/tools/events',
      { params }
    ),
};
