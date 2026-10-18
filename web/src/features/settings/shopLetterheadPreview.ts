import type { ShopDetails } from '../../api/shopDetails.api';

/** Contact lines printed under the letterhead (same wording as PrintTemplate). */
export function shopContactLines(values: Partial<ShopDetails>): string[] {
  return [
    values.telephone?.trim() && `Telephone no. ${values.telephone.trim()}`,
    values.mobileNumbers?.trim() && `Mobile No: ${values.mobileNumbers.trim()}`,
    values.email?.trim() && `Email add: ${values.email.trim()}`,
  ].filter(Boolean) as string[];
}

/** Values shown in the live letterhead preview card. */
export function shopLetterheadPreview(values: Partial<ShopDetails>) {
  return {
    shopName: values.shopName?.trim() || 'Shop name',
    tagline: values.tagline?.trim() || '',
    address: values.address?.trim() || '',
    contacts: shopContactLines(values),
    poApproverName: values.poApproverName?.trim() || 'PO approver',
    poApproverTitle: values.poApproverTitle?.trim() || 'Title',
    joApproverName: values.joApproverName?.trim() || 'JO approver',
    joApproverTitle: values.joApproverTitle?.trim() || 'Title',
  };
}
