import apiClient from './client';
import type { ConsumablePurchase } from '../types';

export interface RecordPurchaseInput {
  toolId: string;
  purchasedOn: string;
  quantity: number;
  unitCost?: number | null;
  boughtFrom?: string | null;
  note?: string | null;
}

/** Consumables are not counted; the shop records what it buys and the forecast reads it. */
export const consumablesApi = {
  purchases: (toolId?: string) =>
    apiClient.get<ConsumablePurchase[]>('/consumables/purchases', { params: toolId ? { toolId } : undefined }),
  record: (data: RecordPurchaseInput) => apiClient.post<ConsumablePurchase>('/consumables/purchases', data),
  remove: (id: string) => apiClient.delete(`/consumables/purchases/${id}`),
};
