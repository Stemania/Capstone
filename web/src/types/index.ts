export type UserRole = 'ADMIN' | 'OFFICE_STAFF' | 'PRODUCTION_WORKER';

export interface WorkerProfile {
  id: string;
  userId: string;
  skills: string[];
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
}

export interface Client {
  id: string;
  name: string;
  contact?: string;
  createdAt?: string;
}

export type JobOrderStatus = 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';
export type JobPriority = 'HIGH' | 'MODERATE' | 'LOW';
export type OperationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type MachineCode = 'LATHE' | 'MILLING' | 'SHAPER' | 'GRINDING' | 'DRILLING';

export interface MachineInfo {
  code: MachineCode | string;
  name: string;
  units: number;
}

export interface RawMaterial {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface Operation {
  id: string;
  jobOrderId: string;
  seq: number;
  name: string;
  machinesNeeded?: string[];
  machineNames?: string[];
  status: OperationStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface JobOrder {
  id: string;
  jobNumber?: string;
  clientId: string;
  clientName?: string;
  title: string;
  description?: string;
  dueDate: string;
  status: JobOrderStatus;
  priority?: JobPriority;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  amount?: number | null;
  rawMaterials?: RawMaterial[];
  assignedWorkerId?: string;
  assignedWorkerName?: string;
  createdById?: string;
  createdAt?: string;
  opsCompleted?: number;
  opsTotal?: number;
  nextOperation?: string | null;
  operations?: Operation[];
}

export interface WorkerSuggestion {
  workerId: string;
  fullName: string;
  email: string;
  skills: string[];
  score: number;
  matchedSkills: string[];
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
