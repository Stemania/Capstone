import apiClient from './client';

export interface ShopDetails {
  shopName: string;
  tagline: string;
  address: string;
  telephone: string;
  mobileNumbers: string;
  email: string;
  poApproverName: string;
  poApproverTitle: string;
  joApproverName: string;
  joApproverTitle: string;
  updatedAt?: string | null;
}

export const shopDetailsApi = {
  get: () => apiClient.get<ShopDetails>('/shop-details'),
  update: (data: Partial<ShopDetails>) => apiClient.put<ShopDetails>('/shop-details', data),
};
