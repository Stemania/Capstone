import apiClient from './client';
import type { Client, JobOrder, MachineInfo, WorkerSuggestion } from '../types';

export const clientsApi = {
  list: (search?: string) =>
    apiClient.get<Client[]>('/clients', { params: search ? { search } : {} }),
  create: (data: { name: string; contact?: string }) =>
    apiClient.post<Client>('/clients', data),
};

export const jobOrdersApi = {
  list: (status?: string) =>
    apiClient.get<JobOrder[]>('/job-orders', { params: status ? { status } : {} }),
  get: (id: string) => apiClient.get<JobOrder>(`/job-orders/${id}`),
  machines: () => apiClient.get<MachineInfo[]>('/job-orders/machines'),
  create: (data: Record<string, unknown>) =>
    apiClient.post<JobOrder>('/job-orders', data),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<JobOrder>(`/job-orders/${id}`, data),
  reassign: (id: string, assignedWorkerId: string) =>
    apiClient.patch<JobOrder>(`/job-orders/${id}/reassign`, { assignedWorkerId }),
};

export const workersApi = {
  list: () => apiClient.get('/workers'),
  suggest: (operations: string[]) =>
    apiClient.post<{ suggestions: WorkerSuggestion[] }>('/workers/suggest', { operations }),
};
