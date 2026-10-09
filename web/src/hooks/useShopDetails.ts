import { useEffect, useState } from 'react';
import { shopDetailsApi, type ShopDetails } from '../api/shopDetails.api';
import { DEFAULT_SHOP_DETAILS } from '../constants/shopLetterhead';

let cache: ShopDetails | null = null;

/** Drop the cached details after the Admin saves them. */
export function invalidateShopDetails() {
  cache = null;
}

/** Saved shop details for printouts; the defaults until they load or if the
 *  request fails, so a printout always has a letterhead. */
export function useShopDetails(): ShopDetails {
  const [details, setDetails] = useState<ShopDetails>(cache ?? DEFAULT_SHOP_DETAILS);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    shopDetailsApi
      .get()
      .then(({ data }) => {
        cache = data;
        if (alive) setDetails(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return details;
}
