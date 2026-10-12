import apiClient from './client';
import type { CrewMember, MaterialWait } from '../types';

/** Lead and helpers: a crew operation sits on every member's worker row. */
export function crewIdsOf(op: { assignedWorkerId?: string | null; helperIds?: string[] }): string[] {
  return op.assignedWorkerId ? [op.assignedWorkerId, ...(op.helperIds || [])] : [];
}

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
  assignedWorkerNickname?: string | null;
  assignedWorkerPhotoVersion?: number | null;
  helperIds?: string[];
  /** Lead first, then helpers. */
  crew?: CrewMember[];
  dueDate?: string | null;
  projectedCompletion?: string | null;
  scheduleFlag?: 'GREEN' | 'AMBER' | 'RED' | null;
  isLate?: boolean;
  scheduleColor?: string | null;
  pausedAt?: string | null;
  /** Paused for over a working day: its booking no longer grows. */
  stalled?: boolean;
  stalledSince?: string | null;
  /** Booked on a unit that is down right now. */
  onDownUnit?: boolean;
  downtimeReason?: string | null;
} & MaterialWait;

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

/** Hours booked inside the period less hours already worked, over the shop's
 * working hours on the units of this type that are not down. */
export type MachineCapacityRow = {
  machineTypeId: string;
  machineTypeCode: string;
  machineTypeName?: string | null;
  bookedHours: number;
  workedHours: number;
  loadHours: number;
  availableHours: number;
  units: number;
  unitsDown: number;
  loadPct: number;
};

export type ScheduleBoardResponse = {
  period: { from: string; to: string };
  timezone: string;
  shopDayWindows: ShopDayWindow[];
  /** Present when board is filtered by workerId — that worker's hours + exceptions. */
  workerDayWindows?: ShopDayWindow[] | null;
  /** The shop's daily break, HH:MM shop time. */
  shopBreak?: { start: string; end: string };
  machineUnits: {
    id: string;
    label: string;
    machineTypeId: string;
    machineTypeCode?: string | null;
    machineTypeName?: string | null;
  }[];
  workers: {
    id: string;
    fullName: string;
    nickname?: string | null;
    role?: string;
    photoVersion?: number | null;
  }[];
  clients: { id: string; name: string }[];
  operations: ScheduleBoardOperation[];
  downtimes: ScheduleBoardDowntime[];
  summary: {
    operationsScheduled: number;
    jobsScheduled: number;
    machinesNearFullCapacity: (MachineCapacityRow & { projectedLoadPct?: number | null })[];
    machineCapacity?: MachineCapacityRow[];
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
