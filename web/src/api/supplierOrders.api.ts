import apiClient from './client';
import type {
  DeliveryMode,
  OutstandingMaterials,
  SupplierOrder,
  SupplierOrderLineInput,
  SupplierOrderPrint,
  SupplierOrderStatus,
} from '../types';

export const supplierOrdersApi = {
  list: (params?: { status?: SupplierOrderStatus | 'OVERDUE'; supplierId?: string }) =>
    apiClient.get<SupplierOrder[]>('/supplier-orders', { params }),
  /** Starts the overdue-delivery and at-risk checks in the background (throttled by the server). */
  overdueCheck: () => apiClient.post<{ started: boolean }>('/supplier-orders/overdue-check'),
  get: (id: string) => apiClient.get<SupplierOrder>(`/supplier-orders/${id}`),
  outstanding: (jobId?: string) =>
    apiClient.get<OutstandingMaterials>('/supplier-orders/outstanding', {
      params: { jobId },
    }),
  /** Adds lines to the supplier's open draft, starting one if there is none. */
  addDraftLines: (supplierId: string, lines: SupplierOrderLineInput[]) =>
    apiClient.post<SupplierOrder>('/supplier-orders/draft-lines', { supplierId, lines }),
  /** Notes and VAT on a draft; terms of payment and mode of delivery until cancelled. */
  update: (
    id: string,
    data: {
      notes?: string | null;
      vatRate?: number | null;
      termsOfPayment?: string;
      deliveryMode?: DeliveryMode;
    }
  ) => apiClient.patch<SupplierOrder>(`/supplier-orders/${id}`, data),
  issue: (id: string, dateIssued?: string) =>
    apiClient.post<SupplierOrder>(`/supplier-orders/${id}/issue`, { dateIssued }),
  changeExpectedDelivery: (id: string, expectedDeliveryDate: string, note: string) =>
    apiClient.patch<SupplierOrder>(`/supplier-orders/${id}/expected-delivery`, {
      expectedDeliveryDate,
      note,
    }),
  cancel: (id: string) => apiClient.post<SupplierOrder>(`/supplier-orders/${id}/cancel`),
  /** Receive order: every open line on one date. */
  receive: (id: string, receivedDate?: string) =>
    apiClient.post<SupplierOrder>(`/supplier-orders/${id}/receive`, { receivedDate }),
  print: (id: string) => apiClient.get<SupplierOrderPrint>(`/supplier-orders/${id}/print`),
  updateLine: (
    id: string,
    lineId: string,
    data: {
      quantity?: number;
      unitCost?: number;
      gradeOrSpec?: string | null;
      materialName?: string;
      unit?: string;
    }
  ) => apiClient.patch<SupplierOrder>(`/supplier-orders/${id}/lines/${lineId}`, data),
  removeLine: (id: string, lineId: string) =>
    apiClient.delete<SupplierOrder>(`/supplier-orders/${id}/lines/${lineId}`),
};
