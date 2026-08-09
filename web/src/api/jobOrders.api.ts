import apiClient from './client';
import type { Client, JobOrder, MachineInfo, Operation, User, WorkerSuggestion } from '../types';

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
};

export const operationsApi = {
  mine: () => apiClient.get<Operation[]>('/operations/mine'),
  start: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/start`, { timestamp }),
  complete: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/complete`, { timestamp }),
  assign: (id: string, assignedWorkerId: string) =>
    apiClient.patch<Operation>(`/operations/${id}/assign`, { assignedWorkerId }),
};

export const workersApi = {
  list: (params?: {
    excludeOperationId?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    machineTypeId?: string;
  }) => apiClient.get<User[]>('/workers', { params }),
  suggest: (
    operations: string[],
    extras?: {
      excludeJobId?: string;
      excludeOperationId?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      machineTypeId?: string;
      operationTypeId?: string;
      operationName?: string;
    }
  ) =>
    apiClient.post<{ suggestions: WorkerSuggestion[] }>('/workers/suggest', {
      operations,
      ...extras,
    }),
};
