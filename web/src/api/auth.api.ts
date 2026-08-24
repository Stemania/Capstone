import apiClient from './client';
import type { LoginResponse, User, UserDevice } from '../types';

const DEVICE_KEY = 'bmsc_device_id';

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export const authApi = {
  login: (identifier: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', {
      identifier,
      password,
      deviceId: getOrCreateDeviceId(),
      deviceLabel: navigator.userAgent.slice(0, 120),
    }),

  me: () => apiClient.get<User>('/auth/me'),

  logout: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  },

  validateInvitation: (token: string, identifier?: string) =>
    apiClient.post<{ valid: boolean; email?: string; fullName?: string }>(
      '/auth/invitation/validate',
      { token, ...(identifier ? { identifier } : {}) },
    ),

  acceptInvitation: (
    token: string,
    password: string,
    passwordConfirm: string,
    identifier?: string,
  ) =>
    apiClient.post<LoginResponse>('/auth/invitation/accept', {
      token,
      password,
      passwordConfirm,
      ...(identifier ? { identifier } : {}),
      deviceId: getOrCreateDeviceId(),
      deviceLabel: navigator.userAgent.slice(0, 120),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post('/auth/password', { currentPassword, newPassword }),

  pinStatus: () =>
    apiClient.get<{ known: boolean; hasPin: boolean }>('/auth/pin/status', {
      params: { deviceId: getOrCreateDeviceId() },
    }),

  setPin: (pin: string) =>
    apiClient.post<UserDevice>('/auth/pin', {
      deviceId: getOrCreateDeviceId(),
      pin,
      deviceLabel: navigator.userAgent.slice(0, 120),
    }),

  removePin: () =>
    apiClient.delete('/auth/pin', { data: { deviceId: getOrCreateDeviceId() } }),

  unlockWithPin: (pin: string) =>
    apiClient.post<LoginResponse>('/auth/pin/unlock', {
      deviceId: getOrCreateDeviceId(),
      pin,
    }),

  listDevices: () => apiClient.get<UserDevice[]>('/auth/devices'),

  revokeDevice: (deviceRowId: string) =>
    apiClient.delete<UserDevice>(`/auth/devices/${deviceRowId}`),
};
