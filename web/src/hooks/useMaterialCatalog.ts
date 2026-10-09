import { useEffect, useState } from 'react';
import { materialCatalogApi, type MaterialCatalogItem } from '../api/materialCatalog.api';

let cache: MaterialCatalogItem[] | null = null;
let pending: Promise<MaterialCatalogItem[]> | null = null;

function load(): Promise<MaterialCatalogItem[]> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = materialCatalogApi
      .list()
      .then(({ data }) => {
        cache = data.items;
        return cache;
      })
      .catch(() => [])
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Drop the cached list after the catalog is edited. */
export function invalidateMaterialCatalog() {
  cache = null;
}

/** Active catalog entries, fetched once per session; [] until loaded or on error. */
export function useMaterialCatalog(): MaterialCatalogItem[] {
  const [items, setItems] = useState<MaterialCatalogItem[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    void load().then((rows) => {
      if (alive) setItems(rows);
    });
    return () => {
      alive = false;
    };
  }, []);
  return items;
}

export function findCatalogItem(
  items: MaterialCatalogItem[],
  name: string | null | undefined
): MaterialCatalogItem | undefined {
  const n = (name || '').trim().toLowerCase();
  if (!n) return undefined;
  return items.find((i) => i.name.toLowerCase() === n);
}
