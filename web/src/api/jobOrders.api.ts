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
  ScheduleProposeResult,
  ScheduleValidateResult,
  ScoringWeights,
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
    notifyBySms?: boolean;
  }) => apiClient.post<Client>('/clients', data),
  update: (
    id: string,
    data: {
      name?: string;
      contact?: string;
      email?: string;
      mobileNumber?: string;
      notifyByEmail?: boolean;
      notifyBySms?: boolean;
    }
  ) => apiClient.patch<Client>(`/clients/${id}`, data),
};

export const jobOrdersApi = {
  list: (params?: {
    status?: string;
    scope?: 'production' | 'drafts' | 'all';
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
  proposeDraftSchedule: (body: Record<string, unknown>) =>
    apiClient.post<ScheduleProposeResult>('/job-orders/schedule/propose', body),
  validateSchedule: (body: Record<string, unknown>) =>
    apiClient.post<ScheduleValidateResult>('/job-orders/schedule/validate', body),
  create: (data: Record<string, unknown>) =>
    apiClient.post<JobOrder>('/job-orders', data),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<JobOrder>(`/job-orders/${id}`, data),
  delete: (id: string) => apiClient.delete(`/job-orders/${id}`),
  release: (id: string) => apiClient.post<JobOrder>(`/job-orders/${id}/release`),
  deliver: (id: string) => apiClient.post<JobOrder>(`/job-orders/${id}/deliver`),
  markMaterialReceived: (id: string, receivedDate?: string) =>
    apiClient.post<JobOrder>(`/job-orders/${id}/material-received`, {
      receivedDate,
    }),
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
  markPurchaseReceived: (jobId: string, purchaseId: string, receivedDate?: string) =>
    apiClient.post<MaterialPurchase>(
      `/job-orders/${jobId}/material-purchases/${purchaseId}/received`,
      { receivedDate }
    ),
  deleteMaterialPurchase: (jobId: string, purchaseId: string) =>
    apiClient.delete(`/job-orders/${jobId}/material-purchases/${purchaseId}`),
  getInvoice: (jobId: string) =>
    apiClient.get<SalesInvoice>(`/job-orders/${jobId}/invoice`),
  issueInvoice: (
    jobId: string,
    data: {
      invoiceDate?: string;
      description?: string;
      subtotal?: number;
      vatRate?: number | null;
    }
  ) => apiClient.post<SalesInvoice>(`/job-orders/${jobId}/invoice`, data),
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
    operationTypeId?: string;
    operationName?: string;
    forChecking?: boolean;
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
    apiClient.post<{ suggestions: WorkerSuggestion[]; weights: ScoringWeights }>(
      '/workers/suggest',
      {
        operations,
        ...extras,
      }
    ),
};
