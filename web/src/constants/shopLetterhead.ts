import type { ShopDetails } from '../api/shopDetails.api';

/** Shop details printed on POs and job orders until the saved ones load
 *  (same defaults as the API). */
export const DEFAULT_SHOP_DETAILS: ShopDetails = {
  shopName: 'BROTHERS MACHINE SHOP and SERVICES CORP.',
  tagline:
    'Industrial, Electrical and Engineering Works, Plastic & Metal Fabrication, General Services',
  address: 'J.P. Laurel National Highway, San Pioquinto, Malvar, Batangas',
  telephone: '(043) 4303524',
  mobileNumbers: '09260056680 / 09157859720',
  email: 'brothersmachining@yahoo.com',
  poApproverName: 'GREGORIO AGAO JR.',
  poApproverTitle: 'General Manager',
  joApproverName: 'GARY AGAO',
  joApproverTitle: 'Production Head',
};

/** "Tel. (043) 4303524 · Mobile 0926… / 0915… · email" */
export function shopContactLine(d: ShopDetails): string {
  return [
    d.telephone && `Tel. ${d.telephone}`,
    d.mobileNumbers && `Mobile ${d.mobileNumbers}`,
    d.email,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Matches api analytics_service.DEFAULT_MIN_OPS */
export const ANALYTICS_DEFAULT_MIN_OPS = 5;
