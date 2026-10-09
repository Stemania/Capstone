import apiClient from './client';

export interface MaterialCatalogItem {
  id: string;
  name: string;
  /** The shop's own word for it, e.g. "41-40" or "Iron". */
  shopTerm: string | null;
  grades: string[];
  defaultUnit: string;
  category: string | null;
  active: boolean;
}

export interface MaterialCatalogList {
  items: MaterialCatalogItem[];
  units: string[];
  categories: string[];
}

export type MaterialCatalogInput = Partial<
  Pick<MaterialCatalogItem, 'name' | 'shopTerm' | 'grades' | 'defaultUnit' | 'category' | 'active'>
>;

export const MATERIAL_UNITS = ['pcs', 'kg', 'm', 'ft', 'sheet'];

export const materialCatalogApi = {
  list: (params?: { search?: string; includeInactive?: boolean }) =>
    apiClient.get<MaterialCatalogList>('/material-catalog', {
      params: {
        search: params?.search || undefined,
        includeInactive: params?.includeInactive ? 'true' : undefined,
      },
    }),
  create: (data: MaterialCatalogInput) =>
    apiClient.post<MaterialCatalogItem>('/material-catalog', data),
  update: (id: string, data: MaterialCatalogInput) =>
    apiClient.patch<MaterialCatalogItem>(`/material-catalog/${id}`, data),
};

/** Matches name, shop term, category or any grade (case-insensitive). */
export function materialMatches(item: MaterialCatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.shopTerm, item.category, ...item.grades]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}
