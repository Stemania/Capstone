import apiClient from './client';

export type ShopDayWindow = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  isWorking: boolean;
};

export type ScheduleBoardSegment = { start: string; end: string };

export type ScheduleBoardOperation = {
  id: string;
  jobOrderId: string;
  jobNumber?: string | null;
  jobTitle?: string | null;
  jobStatus?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  sequenceNo: number;
  operationName: string;
  status: string;
  estimatedHours?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  segments: ScheduleBoardSegment[];
  machineTypeId?: string | null;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  machineUnitId?: string | null;
  machineUnitLabel?: string | null;
  assignedWorkerId?: string | null;
  assignedWorkerName?: string | null;
  dueDate?: string | null;
  projectedCompletion?: string | null;
  scheduleFlag?: 'GREEN' | 'AMBER' | 'RED' | null;
  isLate?: boolean;
};

export type ScheduleBoardDowntime = {
  id: string;
  machineUnitId: string;
  machineUnitLabel?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  segmentStart: string;
  segmentEnd: string;
  reason: string;
  open: boolean;
};

export type ScheduleBoardResponse = {
  period: { from: string; to: string };
  timezone: string;
  shopDayWindows: ShopDayWindow[];
  machineUnits: {
    id: string;
    label: string;
    machineTypeId: string;
    machineTypeCode?: string | null;
    machineTypeName?: string | null;
  }[];
  workers: { id: string; fullName: string }[];
  clients: { id: string; name: string }[];
  operations: ScheduleBoardOperation[];
  downtimes: ScheduleBoardDowntime[];
  summary: {
    operationsScheduled: number;
    machinesNearFullCapacity: {
      machineTypeId: string;
      machineTypeCode: string;
      machineTypeName?: string | null;
      projectedLoadPct?: number | null;
    }[];
    jobsAtRisk: {
      jobOrderId: string;
      jobNumber?: string | null;
      jobTitle?: string | null;
      dueDate?: string | null;
      projectedCompletion?: string | null;
      scheduleFlag?: string | null;
    }[];
  };
};

export const scheduleApi = {
  board: (params: {
    from: string;
    to: string;
    machineTypeId?: string;
    workerId?: string;
    clientId?: string;
    includeCompleted?: boolean;
  }) => apiClient.get<ScheduleBoardResponse>('/schedule/board', { params }),
};
