import apiClient from './client';
import type {
  MachineDowntimeRecord,
  MachineUnitStatus,
  Operation,
  OperationPauseReason,
} from '../types';

export const operationsApi = {
  mine: () => apiClient.get<Operation[]>('/operations/mine'),
  start: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/start`, { timestamp }),
  pause: (id: string, reason: OperationPauseReason, note?: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/pause`, { reason, note, timestamp }),
  resume: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/resume`, { timestamp }),
  complete: (id: string, timestamp?: string) =>
    apiClient.post<Operation>(`/operations/${id}/complete`, { timestamp }),
  rework: (id: string, reason: string) =>
    apiClient.post<Operation>(`/operations/${id}/rework`, { reason }),
  assign: (id: string, assignedWorkerId: string) =>
    apiClient.patch<Operation>(`/operations/${id}/assign`, { assignedWorkerId }),
  machineUnitStatus: () => apiClient.get<MachineUnitStatus[]>('/operations/machine-units/status'),
  openDowntime: (unitId: string, reason: string, note?: string) =>
    apiClient.post<MachineDowntimeRecord>(`/operations/machine-units/${unitId}/downtime`, {
      reason,
      note,
    }),
  closeDowntime: (downtimeId: string, note?: string) =>
    apiClient.post<MachineDowntimeRecord>(`/operations/machine-units/downtime/${downtimeId}/close`, {
      note,
    }),
};
