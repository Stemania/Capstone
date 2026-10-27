import type { PlannedMaterialSummary, RawMaterial } from '../../types';

/** One row of "Materials needed" on the job order form. */
export type PlannedRow = {
  key: number;
  /** Kept from the saved job so supplier orders stay linked to it. */
  id?: string;
  materialCatalogId: string | null;
  materialName: string;
  gradeOrSpec: string;
  sizeSpec: string;
  quantity: number | null;
  unit: string;
  /** Already on draft or issued supplier orders: the material is fixed and the quantity can't go below this. */
  onOrder: number;
};

let nextKey = 1;

export const blankPlannedRow = (): PlannedRow => ({
  key: nextKey++,
  materialCatalogId: null,
  materialName: '',
  gradeOrSpec: '',
  sizeSpec: '',
  quantity: null,
  unit: 'pcs',
  onOrder: 0,
});

export function rowsFromJob(raw: RawMaterial[] = [], summary: PlannedMaterialSummary[] = []): PlannedRow[] {
  return raw
    .filter((m) => m && m.name)
    .map((m) => {
      const s = summary.find((p) => p.id === m.id);
      return {
        key: nextKey++,
        id: m.id,
        materialCatalogId: m.materialCatalogId ?? null,
        materialName: m.name,
        gradeOrSpec: m.gradeOrSpec ?? '',
        sizeSpec: m.sizeSpec ?? '',
        quantity: m.quantity ?? null,
        unit: m.unit || 'pcs',
        onOrder: s ? s.purchasedQuantity + s.draftQuantity : 0,
      };
    });
}

export const isBlankRow = (r: PlannedRow) =>
  !r.id && !r.materialCatalogId && r.quantity == null && !r.gradeOrSpec.trim() && !r.sizeSpec.trim();

export type PlannedPayload = {
  id?: string;
  materialCatalogId: string;
  gradeOrSpec: string | null;
  sizeSpec: string | null;
  quantity: number;
  unit: string;
};

/** The list to send, or the first problem found (with the row it is on). Blank rows are skipped. */
export function plannedPayload(
  rows: PlannedRow[]
): { lines: PlannedPayload[]; error?: undefined } | { lines?: undefined; error: { key: number; message: string } } {
  const lines: PlannedPayload[] = [];
  let n = 0;
  for (const r of rows) {
    if (isBlankRow(r)) continue;
    n += 1;
    const label = r.materialName || `material ${n}`;
    if (!r.materialCatalogId) return { error: { key: r.key, message: `Pick ${label} from the catalog.` } };
    if (r.quantity == null || !(r.quantity > 0)) {
      return { error: { key: r.key, message: `Enter a quantity for ${label}.` } };
    }
    if (r.onOrder > 0 && r.quantity < r.onOrder) {
      return {
        error: {
          key: r.key,
          message: `${label} already has ${r.onOrder} ${r.unit} on order; the quantity can't be lower.`,
        },
      };
    }
    lines.push({
      ...(r.id ? { id: r.id } : {}),
      materialCatalogId: r.materialCatalogId,
      gradeOrSpec: r.gradeOrSpec.trim() || null,
      sizeSpec: r.sizeSpec.trim() || null,
      quantity: r.quantity,
      unit: r.unit,
    });
  }
  return { lines };
}
