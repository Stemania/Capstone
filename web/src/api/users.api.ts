import apiClient from './client';
import type { User } from '../types';

export const usersApi = {
  list: () => apiClient.get<User[]>('/users'),
  create: (data: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    skills?: string[];
  }) => apiClient.post<User>('/users', data),
  update: (id: string, data: Partial<User & { password?: string; skills?: string[] }>) =>
    apiClient.patch<User>(`/users/${id}`, data),
  deactivate: (id: string) => apiClient.delete(`/users/${id}`),
};
