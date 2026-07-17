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
export type OperationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface Operation {
  id: string;
  jobOrderId: string;
  seq: number;
  name: string;
  status: OperationStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface JobOrder {
  id: string;
  clientId: string;
  clientName?: string;
  title: string;
  description?: string;
  dueDate: string;
  status: JobOrderStatus;
  assignedWorkerId?: string;
  assignedWorkerName?: string;
  createdById?: string;
  createdAt?: string;
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
