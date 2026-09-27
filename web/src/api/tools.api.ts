import apiClient from './client';
import type {
  InventoryPurchaseSuggestions,
  InventoryUsageByItem,
  InventoryUsageByWorker,
  InventoryUsageConsumables,
  MaterialPurchaseList,
  StocktakeDetail,
  StocktakeForm,
  StocktakeSummary,
  Tool,
  ToolEvent,
  ToolCategory,
  ToolType,
  ToolUnit,
} from '../types';

export const toolsApi = {
  list: (params?: { category?: ToolCategory }) =>
    apiClient.get<Tool[]>('/tools', { params }),
  create: (data: {
    name: string;
    code?: string;
    category?: ToolCategory;
    unit?: string;
    quantityOnHand?: number;
    minimumStock?: number | null;
    sizeSpec?: string | null;
  }) => apiClient.post<Tool>('/tools', data),
  update: (
    id: string,
    data: {
      name?: string;
      code?: string;
      unit?: string;
      minimumStock?: number | null;
      sizeSpec?: string | null;
    }
  ) => apiClient.patch<Tool>(`/tools/${id}`, data),
  scan: (
    code: string,
    options?: {
      intent?: 'BORROW' | 'RETURN';
      quantity?: number;
    }
  ) =>
    apiClient.post<ToolEvent>('/tools/scan', {
      code,
      intent: options?.intent,
      quantity: options?.quantity,
    }),
  adjust: (id: string, data: { quantity: number; reason: string }) =>
    apiClient.post<ToolEvent>(`/tools/${id}/adjust`, data),
  receive: (
    id: string,
    data: { quantity: number; supplier: string; receivedOn?: string; note?: string }
  ) => apiClient.post<ToolEvent>(`/tools/${id}/receive`, data),
  receiveUnits: (
    typeId: string,
    data: { quantity: number; supplier: string; receivedOn?: string; note?: string }
  ) =>
    apiClient.post<{ items: ToolUnit[]; count: number }>(
      `/tools/types/${typeId}/receive`,
      data
    ),
  myTools: () => apiClient.get<ToolUnit[]>('/tools/my'),
  myHistory: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<{ items: ToolEvent[]; total: number; page: number; pages: number }>(
      '/tools/my/history',
      { params }
    ),
  listEvents: (params?: {
    toolId?: string;
    category?: 'CONSUMABLE' | 'TOOL' | 'RETURNABLE_TOOL' | ToolCategory;
    page?: number;
    perPage?: number;
  }) =>
    apiClient.get<{ items: ToolEvent[]; total: number; page: number; pages: number }>(
      '/tools/events',
      { params }
    ),

  listTypes: (params?: { onlyWithOut?: boolean; includeUnits?: boolean }) =>
    apiClient.get<ToolType[]>('/tools/types', {
      params: {
        onlyWithOut: params?.onlyWithOut ? 'true' : undefined,
        includeUnits: params?.includeUnits ? 'true' : undefined,
      },
    }),
  getType: (id: string) => apiClient.get<ToolType>(`/tools/types/${id}`),
  createType: (data: { name: string; code?: string; description?: string }) =>
    apiClient.post<ToolType>('/tools/types', data),
  updateType: (
    id: string,
    data: { name?: string; code?: string; description?: string }
  ) => apiClient.patch<ToolType>(`/tools/types/${id}`, data),
  createUnit: (
    typeId: string,
    data: { assetCode?: string; notes?: string; status?: string }
  ) => apiClient.post<ToolUnit>(`/tools/types/${typeId}/units`, data),
  updateUnit: (
    id: string,
    data: { assetCode?: string; notes?: string; status?: string }
  ) => apiClient.patch<ToolUnit>(`/tools/units/${id}`, data),
  lookupUnit: (code: string) =>
    apiClient.get<ToolUnit>('/tools/units/lookup', { params: { code } }),
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
  usageConsumables: (params?: { from?: string; to?: string }) =>
    apiClient.get<InventoryUsageConsumables>('/inventory/usage/consumables', { params }),
  materialPurchases: (params?: {
    from?: string;
    to?: string;
    supplierId?: string;
    material?: string;
    status?: 'ORDERED' | 'RECEIVED' | string;
  }) =>
    apiClient.get<MaterialPurchaseList>('/inventory/material-purchases', { params }),
  stocktakeForm: () => apiClient.get<StocktakeForm>('/inventory/stocktakes/form'),
  listStocktakes: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<{ items: StocktakeSummary[]; total: number; page: number; pages: number }>(
      '/inventory/stocktakes',
      { params }
    ),
  getStocktake: (id: string) => apiClient.get<StocktakeDetail>(`/inventory/stocktakes/${id}`),
  submitStocktake: (data: {
    countedOn?: string;
    notes?: string;
    lines: { toolId: string; countedQuantity: number }[];
  }) => apiClient.post<StocktakeDetail>('/inventory/stocktakes', data),
};
