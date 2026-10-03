import apiClient from './client';
import type { Supplier, SupplierReliability } from '../types';

export const suppliersApi = {
  list: (params?: { search?: string; activeOnly?: boolean }) =>
    apiClient.get<Supplier[]>('/suppliers', {
      params: {
        search: params?.search,
        activeOnly: params?.activeOnly ? 'true' : undefined,
      },
    }),
  get: (id: string) => apiClient.get<Supplier>(`/suppliers/${id}`),
  /** All delivery history, or only deliveries promised within from–to. */
  reliability: (params?: { from?: string; to?: string }) =>
    apiClient.get<SupplierReliability[]>('/suppliers/reliability', { params }),
  create: (data: {
    name: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    typicalLeadTimeDays?: number | null;
    notes?: string;
    active?: boolean;
  }) => apiClient.post<Supplier>('/suppliers', data),
  update: (
    id: string,
    data: {
      name?: string;
      contactPerson?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      typicalLeadTimeDays?: number | null;
      notes?: string | null;
      active?: boolean;
    }
  ) => apiClient.patch<Supplier>(`/suppliers/${id}`, data),
};
