import apiClient from './client';
import type {
  InventoryPurchaseSuggestions,
  InventoryUsageByItem,
  InventoryUsageByWorker,
  Tool,
  ToolEvent,
  ToolCategory,
} from '../types';

export const toolsApi = {
  list: () => apiClient.get<Tool[]>('/tools'),
  create: (data: {
    name: string;
    code?: string;
    category?: ToolCategory;
    unit?: string;
    quantityOnHand?: number;
    minimumStock?: number | null;
    sizeSpec?: string | null;
  }) => apiClient.post<Tool>('/tools', data),
  get: (id: string) => apiClient.get<Tool>(`/tools/${id}`),
  getQrUrl: (id: string) => `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/tools/${id}/qr`,
  scan: (
    code: string,
    options?: {
      jobOrderId?: string;
      intent?: 'BORROW' | 'RETURN' | 'ISSUE';
      quantity?: number;
    }
  ) =>
    apiClient.post<ToolEvent>('/tools/scan', {
      code,
      jobOrderId: options?.jobOrderId,
      intent: options?.intent,
      quantity: options?.quantity,
    }),
  adjust: (id: string, data: { quantity: number; reason: string }) =>
    apiClient.post<ToolEvent>(`/tools/${id}/adjust`, data),
  myTools: () =>
    apiClient.get<
      {
        id: string;
        name: string;
        code: string;
        category: string;
        sizeSpec: string | null;
        unit: string;
        quantity: number;
        quantityOnHand: number;
        since: string | null;
      }[]
    >('/tools/my'),
  myHistory: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<{ items: ToolEvent[]; total: number; page: number; pages: number }>(
      '/tools/my/history',
      { params }
    ),
  listEvents: (params?: { toolId?: string; page?: number; perPage?: number }) =>
    apiClient.get<{ items: ToolEvent[]; total: number; page: number; pages: number }>(
      '/tools/events',
      { params }
    ),
};

export const inventoryApi = {
  purchaseSuggestions: (params?: { lookbackDays?: number }) =>
    apiClient.get<InventoryPurchaseSuggestions>('/inventory/purchase-suggestions', {
      params,
    }),
  usageByWorker: (params?: { from?: string; to?: string }) =>
    apiClient.get<InventoryUsageByWorker>('/inventory/usage/by-worker', { params }),
  usageByItem: (params?: { from?: string; to?: string }) =>
    apiClient.get<InventoryUsageByItem>('/inventory/usage/by-item', { params }),
};
