import apiClient from './client';

export type CalendarExceptionType =
  | 'OVERTIME'
  | 'SPECIAL_WORKING_DAY'
  | 'HOLIDAY_NO_WORK';

export interface WorkCalendarException {
  id: string;
  date: string;
  type: CalendarExceptionType;
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
}

export interface CalendarDeleteImpact {
  exceptionId: string;
  date: string;
  type: CalendarExceptionType;
  affectedCount: number;
  affectedOperations: {
    id: string;
    jobOrderId: string;
    jobNumber?: string | null;
    operationName: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
  }[];
}

export interface CalendarAffectedJob {
  jobOrderId: string;
  jobNumber: string;
  title: string;
  clientName?: string | null;
  dueDate?: string | null;
  operations: {
    id: string;
    sequenceNo: number;
    operationName: string;
    scheduledStart: string;
    scheduledEnd: string;
  }[];
}

/** Daily break on every working day (shop-local HH:MM); never working time. */
export interface ShopBreak {
  breakStart: string;
  breakEnd: string;
  updatedAt?: string | null;
}

export const calendarApi = {
  getBreak: () => apiClient.get<ShopBreak>('/calendar/break'),
  setBreak: (body: { breakStart: string; breakEnd: string }) =>
    apiClient.put<ShopBreak & { affectedJobs: CalendarAffectedJob[] }>('/calendar/break', body),
  affectedJobs: (from: string, to?: string) =>
    apiClient.get<{ from: string; to: string; jobs: CalendarAffectedJob[] }>(
      '/calendar/affected-jobs',
      { params: { from, to } }
    ),
  list: (from?: string, to?: string) =>
    apiClient.get<WorkCalendarException[]>('/calendar/exceptions', {
      params: { from, to },
    }),
  create: (body: {
    type: CalendarExceptionType;
    date: string;
    dateTo?: string;
    startTime?: string | null;
    endTime?: string | null;
    note?: string | null;
  }) => apiClient.post<WorkCalendarException[]>('/calendar/exceptions', body),
  update: (
    id: string,
    body: {
      type?: CalendarExceptionType;
      date?: string;
      startTime?: string | null;
      endTime?: string | null;
      note?: string | null;
    }
  ) => apiClient.patch<WorkCalendarException>(`/calendar/exceptions/${id}`, body),
  deleteImpact: (id: string) =>
    apiClient.get<CalendarDeleteImpact>(`/calendar/exceptions/${id}/delete-impact`),
  remove: (id: string) => apiClient.delete(`/calendar/exceptions/${id}`),
};
