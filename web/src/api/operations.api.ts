import apiClient from './client';
import type {
  MachineDowntimeRecord,
  MachineUnitInfo,
  MachineUnitStatus,
  Operation,
  OperationPauseReason,
  ReworkReasonCategory,
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
  rework: (
    id: string,
    data: { category: ReworkReasonCategory; reason?: string; note?: string }
  ) =>
    apiClient.post<Operation>(`/operations/${id}/rework`, {
      category: data.category,
      reason: data.reason ?? data.note,
    }),
  assign: (id: string, assignedWorkerId: string) =>
    apiClient.patch<Operation>(`/operations/${id}/assign`, { assignedWorkerId }),
  machineUnitStatus: (includeInactive = false) =>
    apiClient.get<MachineUnitStatus[]>('/operations/machine-units/status', {
      params: includeInactive ? { includeInactive: true } : undefined,
    }),
  createMachineUnit: (machineTypeId: string, label?: string) =>
    apiClient.post<MachineUnitInfo>('/operations/machine-units', {
      machineTypeId,
      label: label || undefined,
    }),
  setMachineUnitActive: (unitId: string, active: boolean) =>
    apiClient.patch<MachineUnitStatus>(`/operations/machine-units/${unitId}`, { active }),
  setMachineUnitDefaultOperator: (unitId: string, defaultOperatorId: string | null) =>
    apiClient.patch<MachineUnitInfo>(`/operations/machine-units/${unitId}`, {
      defaultOperatorId,
    }),
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
