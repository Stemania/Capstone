import apiClient from './client';
import { getOrCreateDeviceId, thisDeviceLabel } from './device';
import type { LoginResponse, User, UserDevice } from '../types';

export { getOrCreateDeviceId };

export const authApi = {
  login: (identifier: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', {
      identifier,
      password,
      deviceId: getOrCreateDeviceId(),
      deviceLabel: thisDeviceLabel(),
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
      deviceLabel: thisDeviceLabel(),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post('/auth/password', { currentPassword, newPassword }),

  requestPasswordReset: (identifier: string) =>
    apiClient.post<{ message: string }>('/auth/password-reset/request', { identifier }),

  validatePasswordReset: (token: string, identifier?: string) =>
    apiClient.post<{ valid: boolean; email?: string; fullName?: string }>(
      '/auth/password-reset/validate',
      { token, ...(identifier ? { identifier } : {}) },
    ),

  confirmPasswordReset: (
    token: string,
    password: string,
    passwordConfirm: string,
    identifier?: string,
  ) =>
    apiClient.post<LoginResponse>('/auth/password-reset/confirm', {
      token,
      password,
      passwordConfirm,
      ...(identifier ? { identifier } : {}),
      deviceId: getOrCreateDeviceId(),
      deviceLabel: thisDeviceLabel(),
    }),

  pinStatus: () =>
    apiClient.get<{ known: boolean; hasPin: boolean }>('/auth/pin/status', {
      params: { deviceId: getOrCreateDeviceId() },
    }),

  setPin: (pin: string) =>
    apiClient.post<UserDevice>('/auth/pin', {
      deviceId: getOrCreateDeviceId(),
      pin,
      deviceLabel: thisDeviceLabel(),
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

  signOutOtherDevices: () =>
    apiClient.post<{ signedOut: number }>('/auth/devices/sign-out-others', {
      deviceId: getOrCreateDeviceId(),
    }),
};
