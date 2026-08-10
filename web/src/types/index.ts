export type UserRole = 'ADMIN' | 'OFFICE_STAFF' | 'PRODUCTION_WORKER';

export interface WorkerSkill {
  id?: string;
  workerId?: string;
  machineTypeId: string;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  proficiency: number;
  isPrimary: boolean;
}

export interface WorkerSchedule {
  id?: string;
  workerId?: string;
  dayOfWeek: number;
  startTime?: string | null;
  endTime?: string | null;
  isWorking: boolean;
}

export interface OperationType {
  id: string;
  code: string;
  name: string;
  defaultMachineTypeId?: string | null;
  defaultMachineTypeCode?: string | null;
  defaultMachineTypeName?: string | null;
  active: boolean;
}

export interface WorkerProfile {
  id: string | null;
  userId: string;
  skills: WorkerSkill[] | string[];
  fullName?: string;
  email?: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  workerProfile?: WorkerProfile;
  skills?: WorkerSkill[];
  schedules?: WorkerSchedule[];
  available?: boolean;
  activeJobId?: string;
  activeJobTitle?: string;
  conflictOperationId?: string;
}

export interface Client {
  id: string;
  name: string;
  contact?: string;
  createdAt?: string;
}

export type JobOrderStatus = 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';
export type JobPriority = 'HIGH' | 'MODERATE' | 'LOW';
export type JobType = 'FABRICATION' | 'MODIFICATION' | 'REPAIR';
export type MaterialSource = 'SHOP_PROCURED' | 'CLIENT_SUPPLIED';
export type PartCondition =
  | 'RAW_MATERIAL'
  | 'CLIENT_SUPPLIED_ITEM'
  | 'BLANK'
  | 'WORK_IN_PROCESS'
  | 'MACHINED'
  | 'HEAT_TREATED'
  | 'FINISHED';
export type OperationStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REWORK';
export type MachineCode = 'LATHE' | 'MILLING' | 'SHAPER' | 'GRINDING' | 'DRILLING';

export interface MachineInfo {
  id?: string | null;
  code: MachineCode | string;
  name: string;
  units: number;
  inUse?: number;
  available?: number;
}

export interface RawMaterial {
  name: string;
  quantity?: number;
  unit?: string;
}

export type OperationTimeEvent = 'START' | 'PAUSE' | 'RESUME' | 'COMPLETE';

export type OperationPauseReason =
  | 'END_OF_SHIFT'
  | 'BREAK'
  | 'MACHINE_DOWN'
  | 'WAITING_MATERIAL'
  | 'WAITING_PRIOR_OPERATION'
  | 'OTHER';

export interface OperationTimeLog {
  id: string;
  operationId: string;
  workerId: string;
  workerName?: string | null;
  event: OperationTimeEvent;
  eventAt: string;
  reason?: OperationPauseReason | null;
  note?: string | null;
}

export type ScheduleFlag = 'GREEN' | 'AMBER' | 'RED';

export interface ScheduleSegment {
  start: string;
  end: string;
}

export interface Operation {
  id: string;
  jobOrderId: string;
  jobTitle?: string;
  jobNumber?: string;
  clientName?: string;
  dueDate?: string;
  jobPriority?: JobPriority;
  sequenceNo: number;
  operationName: string;
  operationTypeId?: string | null;
  operationTypeCode?: string | null;
  machineTypeId?: string | null;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  machineUnitId?: string | null;
  machineUnitLabel?: string | null;
  assignedWorkerId?: string | null;
  assignedWorkerName?: string | null;
  estimatedHours?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  segments?: ScheduleSegment[];
  actualStart?: string | null;
  actualEnd?: string | null;
  actualWorkedHours?: number | null;
  varianceHours?: number | null;
  variancePct?: number | null;
  startedAt?: string;
  completedAt?: string;
  status: OperationStatus;
  reworkOfOperationId?: string | null;
  reworkReason?: string | null;
  notes?: string | null;
  timeLogs?: OperationTimeLog[];
  isPaused?: boolean;
  /** Legacy aliases */
  seq?: number;
  name?: string;
  machinesNeeded?: string[];
  machineNames?: string[];
}

export interface MachineUnitInfo {
  id: string;
  machineTypeId: string;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  label: string;
  active?: boolean;
}

export interface ProposedOperation {
  id?: string | null;
  sequenceNo: number;
  operationName?: string;
  assignedWorkerId?: string | null;
  machineTypeId?: string | null;
  machineUnitId?: string | null;
  machineUnitLabel?: string | null;
  estimatedHours?: number;
  estimatedHoursDefaulted?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  segments?: ScheduleSegment[];
  scheduled: boolean;
  message?: string | null;
  placeableHours?: number | null;
  requiredHours?: number | null;
}

export interface ScheduleProposeResult {
  proposed: boolean;
  anchor?: string;
  horizonDays?: number;
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
  operations: ProposedOperation[];
}

export interface ScheduleWarning {
  sequenceNo: number;
  code: string;
  message: string;
}

export interface ScheduleValidateResult {
  warnings: ScheduleWarning[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
}

export interface JobOrder {
  id: string;
  jobNumber?: string;
  clientId: string;
  clientName?: string;
  title: string;
  description?: string;
  dueDate: string;
  clientPoNumber?: string | null;
  poDate?: string | null;
  status: JobOrderStatus;
  priority?: JobPriority;
  jobType?: JobType;
  materialSource?: MaterialSource;
  partCondition?: PartCondition;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  amount?: number | null;
  rawMaterials?: RawMaterial[];
  createdById?: string;
  createdAt?: string;
  opsCompleted?: number;
  opsTotal?: number;
  nextOperation?: string | null;
  nextOperationWorkerId?: string | null;
  nextOperationWorkerName?: string | null;
  operations?: Operation[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
}

export interface ScoringComponents {
  skill: number;
  availability: number;
  workload: number;
  efficiency: number;
}

export interface ScoringWeights {
  skill: number;
  availability: number;
  workload: number;
  efficiency: number;
}

export interface WorkerSuggestion {
  workerId: string;
  fullName: string;
  email: string;
  skills: string[];
  score: number;
  matchedSkills: string[];
  available?: boolean;
  proficiency?: number | null;
  qualified?: boolean;
  components?: ScoringComponents;
  reason?: string;
}

export interface Tool {
  id: string;
  name: string;
  code: string;
  createdAt?: string;
  custody?: {
    holderId: string;
    holderName: string;
    since: string;
  } | null;
}

export type ToolEventType = 'BORROW' | 'RETURN';

export interface ToolEvent {
  id: string;
  toolId: string;
  toolName?: string;
  toolCode?: string;
  workerId: string;
  workerName?: string;
  type: ToolEventType;
  jobOrderId?: string;
  createdAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export const MACHINE_OPTIONS: MachineInfo[] = [
  { code: 'LATHE', name: 'Lathe', units: 7 },
  { code: 'MILLING', name: 'Milling', units: 8 },
  { code: 'SHAPER', name: 'Shaper', units: 1 },
  { code: 'GRINDING', name: 'Grinding', units: 2 },
  { code: 'DRILLING', name: 'Drilling', units: 1 },
];
