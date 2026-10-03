import apiClient from './client';
import type { AttendanceDaySheet, AttendanceHistory, AttendanceRecord } from '../types';

export const attendanceApi = {
  day: (date: string) => apiClient.get<AttendanceDaySheet>('/attendance/day', { params: { date } }),
  history: (workerId: string, params: { from: string; to: string }) =>
    apiClient.get<AttendanceHistory>(`/attendance/workers/${workerId}`, { params }),
  clockIn: (data: { workerId: string; clockIn: string; note?: string }) =>
    apiClient.post<AttendanceRecord>('/attendance/clock-in', data),
  clockOut: (id: string, data: { clockOut: string }) =>
    apiClient.post<AttendanceRecord>(`/attendance/${id}/clock-out`, data),
  update: (id: string, data: { clockIn?: string; clockOut?: string | null; note?: string | null }) =>
    apiClient.patch<AttendanceRecord>(`/attendance/${id}`, data),
  remove: (id: string) => apiClient.delete(`/attendance/${id}`),
  dayCsv: (date: string) =>
    apiClient.get<string>('/attendance/day.csv', { params: { date }, responseType: 'text' }),
  historyCsv: (workerId: string, params: { from: string; to: string }) =>
    apiClient.get<string>(`/attendance/workers/${workerId}.csv`, {
      params,
      responseType: 'text',
    }),
};
