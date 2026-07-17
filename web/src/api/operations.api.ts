import apiClient from './client';
import type { Operation } from '../types';

export const operationsApi = {
  start: (id: string, timestamp: string) =>
    apiClient.post<Operation>(`/operations/${id}/start`, { timestamp }),
  complete: (id: string, timestamp: string) =>
    apiClient.post<Operation>(`/operations/${id}/complete`, { timestamp }),
};
