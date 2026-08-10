import apiClient from './client';
import type {
  AnalyticsByMachine,
  AnalyticsByOperationType,
  AnalyticsByWorker,
  AnalyticsDelays,
  AnalyticsOverview,
  AnalyticsTrend,
} from '../types';

export type AnalyticsDateParams = {
  from?: string;
  to?: string;
  minOps?: number;
};

export const analyticsApi = {
  overview: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsOverview>('/analytics/overview', { params }),
  byWorker: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsByWorker>('/analytics/efficiency/by-worker', { params }),
  byOperationType: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsByOperationType>('/analytics/efficiency/by-operation-type', {
      params,
    }),
  byMachine: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsByMachine>('/analytics/efficiency/by-machine', { params }),
  trend: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsTrend>('/analytics/efficiency/trend', { params }),
  delays: (params?: AnalyticsDateParams) =>
    apiClient.get<AnalyticsDelays>('/analytics/delays', { params }),
};
