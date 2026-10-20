import apiClient from './client';
import type {
  Client,
  ClientDetail,
  JobOrder,
  MachineDowntimeRecord,
  MachineInfo,
  MachineUnitInfo,
  MaterialPurchase,
  Operation,
  SalesInvoice,
  ScheduleMove,
  ScheduleProposeResult,
  ScheduleValidateResult,
  ScoringWeights,
  SuggestionMode,
  User,
  WorkerSuggestion,
} from '../types';

export const clientsApi = {
  list: (search?: string) =>
    apiClient.get<Client[]>('/clients', { params: search ? { search } : {} }),
  get: (id: string) => apiClient.get<ClientDetail>(`/clients/${id}`),
  create: (data: {
    name: string;
    contact?: string;
    email?: string;
    mobileNumber?: string;
    notifyByEmail?: boolean;
  }) => apiClient.post<Client>('/clients', data),
  update: (
    id: string,
    data: {
      name?: string;
      contact?: string;
      email?: string;
      mobileNumber?: string;
      notifyByEmail?: boolean;
    }
  ) => apiClient.patch<Client>(`/clients/${id}`, data),
};

export const jobOrdersApi = {
  list: (params?: {
    status?: string;
    scope?: 'production' | 'drafts' | 'archived' | 'all';
    awaitingMaterial?: boolean;
  }) =>
    apiClient.get<JobOrder[]>('/job-orders', {
      params: {
        ...params,
        awaitingMaterial: params?.awaitingMaterial ? '1' : undefined,
      },
    }),
  get: (id: string) => apiClient.get<JobOrder>(`/job-orders/${id}`),
  machines: () => apiClient.get<MachineInfo[]>('/job-orders/machines'),
  machineUnits: () => apiClient.get<MachineUnitInfo[]>('/job-orders/machine-units'),
  proposeSchedule: (jobId: string, body?: Record<string, unknown>) =>
    apiClient.post<ScheduleProposeResult>(`/job-orders/${jobId}/schedule/propose`, body || {}),
  applySchedule: (
    jobId: string,
    operations: {
      id: string;
      scheduledStart: string;
      scheduledEnd: string;
      machineUnitId?: string | null;
      assignedWorkerId?: string | null;
    }[]
  ) => apiClient.post<JobOrder>(`/job-orders/${jobId}/schedule/apply`, { operations }),
  reschedule: (
    jobId: string,
    operations: {
      id: string;
      scheduledStart: string;
      scheduledEnd: string;
      machineUnitId?: string | null;
      assignedWorkerId?: string | null;
    }[],
    reason: string,
    note?: string
  ) =>
    apiClient.post<JobOrder>(`/job-orders/${jobId}/schedule/reschedule`, {
      operations,
      reason,
      note,
    }),
  listScheduleMoves: (jobId: string) =>
    apiClient.get<ScheduleMove[]>(`/job-orders/${jobId}/schedule-moves`),
  proposeDraftSchedule: (body: Record<string, unknown>) =>
    apiClient.post<ScheduleProposeResult>('/job-orders/schedule/propose', body),
  validateSchedule: (body: Record<string, unknown>) =>
    apiClient.post<ScheduleValidateResult>('/job-orders/schedule/validate', body),
  create: (data: Record<string, unknown>) =>
    apiClient.post<JobOrder>('/job-orders', data),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<JobOrder>(`/job-orders/${id}`, data),
  cancel: (id: string, data: { reason: string; note?: string }) =>
    apiClient.post<JobOrder>(`/job-orders/${id}/cancel`, data),
  archive: (id: string) => apiClient.post<JobOrder>(`/job-orders/${id}/archive`),
  unarchive: (id: string) => apiClient.post<JobOrder>(`/job-orders/${id}/unarchive`),
  confirmSchedule: (id: string, body: Record<string, unknown>) =>
    apiClient.post<JobOrder>(`/job-orders/${id}/schedule/confirm`, body),
  deliver: (id: string) => apiClient.post<JobOrder>(`/job-orders/${id}/deliver`),
  listBreakdowns: (jobId: string) =>
    apiClient.get<MachineDowntimeRecord[]>(`/job-orders/${jobId}/breakdowns`),
  listMaterialPurchases: (jobId: string) =>
    apiClient.get<MaterialPurchase[]>(`/job-orders/${jobId}/material-purchases`),
  createMaterialPurchase: (jobId: string, data: Record<string, unknown>) =>
    apiClient.post<MaterialPurchase>(`/job-orders/${jobId}/material-purchases`, data),
  updateMaterialPurchase: (
    jobId: string,
    purchaseId: string,
    data: Record<string, unknown>
  ) =>
    apiClient.patch<MaterialPurchase>(
      `/job-orders/${jobId}/material-purchases/${purchaseId}`,
      data
    ),
  deleteMaterialPurchase: (jobId: string, purchaseId: string) =>
    apiClient.delete(`/job-orders/${jobId}/material-purchases/${purchaseId}`),
  recordInvoice: (
    jobId: string,
    data: { invoiceNumber: string; invoiceDate: string; amount?: number | null }
  ) => apiClient.post<SalesInvoice>(`/job-orders/${jobId}/invoice`, data),
  correctInvoice: (
    jobId: string,
    data: { invoiceNumber?: string; invoiceDate?: string; amount?: number | null; reason: string }
  ) => apiClient.patch<SalesInvoice>(`/job-orders/${jobId}/invoice`, data),
};

export const operationsApi = {
  mine: () => apiClient.get<Operation[]>('/operations/mine'),
  start: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/start`, { timestamp }),
  complete: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/complete`, { timestamp }),
  assign: (id: string, assignedWorkerId: string, helperIds?: string[]) =>
    apiClient.patch<Operation>(`/operations/${id}/assign`, {
      assignedWorkerId,
      ...(helperIds ? { helperIds } : {}),
    }),
};

export const workersApi = {
  list: (params?: {
    excludeOperationId?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    machineTypeId?: string;
    operationTypeId?: string;
    operationName?: string;
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
      /** Helper suggestions: the chosen lead, left out of the list. */
      leadId?: string;
      excludeWorkerIds?: string[];
      /** Machine leads as every (worker, unit) pair they could use, with next-free times. */
      pairs?: boolean;
      estimatedHours?: number | null;
    }
  ) =>
    apiClient.post<{ suggestions: WorkerSuggestion[]; weights: ScoringWeights; mode?: SuggestionMode }>(
      '/workers/suggest',
      {
        operations,
        ...extras,
      }
    ),
};
