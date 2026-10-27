import { describe, expect, it } from 'vitest';
import { blankPlannedRow, plannedPayload, rowsFromJob } from './plannedMaterials';
import { linesFromPlanned } from '../supplier-orders/OrderMaterialsModal';
import type { PlannedMaterialSummary } from '../../types';

const row = (patch: Partial<ReturnType<typeof blankPlannedRow>>) => ({ ...blankPlannedRow(), ...patch });

describe('plannedPayload', () => {
  it('skips blank rows and sends catalog lines', () => {
    const out = plannedPayload([
      blankPlannedRow(),
      row({ materialCatalogId: 'cat-1', materialName: 'Round bar', quantity: 4, unit: 'pcs', gradeOrSpec: ' 1045 ' }),
    ]);
    expect(out.error).toBeUndefined();
    expect(out.lines).toEqual([
      { materialCatalogId: 'cat-1', gradeOrSpec: '1045', sizeSpec: null, quantity: 4, unit: 'pcs' },
    ]);
  });

  it('keeps the saved id so supplier orders stay linked', () => {
    const out = plannedPayload([row({ id: 'p-1', materialCatalogId: 'cat-1', materialName: 'Plate', quantity: 1 })]);
    expect(out.lines?.[0].id).toBe('p-1');
  });

  it('asks for a catalog material and a quantity', () => {
    const noMaterial = row({ quantity: 2 });
    expect(plannedPayload([noMaterial]).error?.key).toBe(noMaterial.key);
    const noQty = row({ materialCatalogId: 'cat-1', materialName: 'Plate' });
    expect(plannedPayload([noQty]).error?.message).toMatch(/quantity for Plate/);
  });

  it('refuses a quantity below what is already on order', () => {
    const r = row({ id: 'p-1', materialCatalogId: 'cat-1', materialName: 'Plate', quantity: 2, onOrder: 3 });
    expect(plannedPayload([r]).error?.message).toMatch(/already has 3/);
  });
});

describe('rowsFromJob', () => {
  it('carries what is on order from the summary', () => {
    const [r] = rowsFromJob(
      [{ id: 'p-1', materialCatalogId: 'cat-1', name: 'Plate', quantity: 5, unit: 'sheet' }],
      [{ id: 'p-1', purchasedQuantity: 2, draftQuantity: 1 } as PlannedMaterialSummary],
    );
    expect(r.onOrder).toBe(3);
    expect(r.unit).toBe('sheet');
  });
});

describe('linesFromPlanned', () => {
  const base = {
    unit: 'pcs',
    plannedQuantity: 5,
    purchasedQuantity: 0,
    draftQuantity: 0,
    fromStock: false,
  };
  it('fills in only what is still to order, at the remaining quantity', () => {
    const lines = linesFromPlanned('job-1', [
      { ...base, id: 'a', name: 'Plate', materialCatalogId: 'cat-1', remainingQuantity: 5, status: 'TO_ORDER' },
      { ...base, id: 'b', name: 'Bar', materialCatalogId: 'cat-2', remainingQuantity: 2, status: 'PARTLY_ORDERED' },
      { ...base, id: 'c', name: 'Pipe', materialCatalogId: 'cat-3', remainingQuantity: 0, status: 'PURCHASED' },
      { ...base, id: 'd', name: 'Old free text', materialCatalogId: null, remainingQuantity: 1, status: 'TO_ORDER' },
    ]);
    expect(lines.map((l) => [l.plannedMaterialId, l.quantity])).toEqual([
      ['a', 5],
      ['b', 2],
    ]);
    expect(lines[0].jobOrderId).toBe('job-1');
    expect(lines[0].unitCost).toBeNull();
  });
});
