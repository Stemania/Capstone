import apiClient from './client';
import type { OperationType, User, WorkerSchedule, WorkerSkill } from '../types';

export const usersApi = {
  list: () => apiClient.get<User[]>('/users'),
  get: (id: string) => apiClient.get<User>(`/users/${id}`),
  create: (data: {
    email: string;
    fullName: string;
    role: string;
    mobileNumber: string;
    inviteChannel?: 'EMAIL' | 'SMS';
  }) => apiClient.post<User>('/users', data),
  update: (id: string, data: Partial<User>) =>
    apiClient.patch<User>(`/users/${id}`, data),
  deactivate: (id: string) => apiClient.delete(`/users/${id}`),
  resendInvite: (id: string, channel?: 'EMAIL' | 'SMS') =>
    apiClient.post(`/users/${id}/invite`, channel ? { channel } : {}),
  revokeInvite: (id: string) => apiClient.delete(`/users/${id}/invite`),
  revokeDevices: (id: string) => apiClient.delete(`/users/${id}/devices`),
};

export const workerProfileApi = {
  getSkills: (workerId: string) =>
    apiClient.get<WorkerSkill[]>(`/workers/${workerId}/skills`),
  putSkills: (workerId: string, skills: Omit<WorkerSkill, 'id' | 'workerId'>[]) =>
    apiClient.put<WorkerSkill[]>(`/workers/${workerId}/skills`, { skills }),
  getSchedule: (workerId: string) =>
    apiClient.get<WorkerSchedule[]>(`/workers/${workerId}/schedule`),
  putSchedule: (workerId: string, schedule: Omit<WorkerSchedule, 'id' | 'workerId'>[]) =>
    apiClient.put<WorkerSchedule[]>(`/workers/${workerId}/schedule`, { schedule }),
  getDetail: (workerId: string) =>
    apiClient.get<User>(`/workers/${workerId}`),
};

export const operationTypesApi = {
  list: (activeOnly = true) =>
    apiClient.get<OperationType[]>('/operation-types', {
      params: activeOnly ? {} : { active: 'false' },
    }),
};
