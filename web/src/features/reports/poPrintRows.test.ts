import { describe, expect, it } from 'vitest';
import { poPrintRows } from './poPrintRows';

const line = (materialName: string, sizeSpec: string | null, extra: object = {}) => ({
  materialName,
  sizeSpec,
  gradeOrSpec: null,
  unit: 'pcs',
  unitCost: 100,
  quantity: 1,
  lineCount: 1,
  amount: 100,
  ...extra,
});

describe('poPrintRows', () => {
  it('prints the material once with each size below it, like the shop PO', () => {
    const rows = poPrintRows([
      line('1045', '320mm dia x 170mmL'),
      line('6061', '10mm plate'),
      line('1045', '160mm dia x 40"'),
    ]);
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ['heading', '1045'],
      ['line', '320mm dia x 170mmL'],
      ['line', '160mm dia x 40"'],
      ['heading', '6061'],
      ['line', '10mm plate'],
    ]);
  });

  it('keeps a single line without a size on one row', () => {
    const rows = poPrintRows([line('Cutting oil', null, { isConsumable: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'line', text: 'Cutting oil' });
  });

  it('keeps an older grade with its material name', () => {
    const rows = poPrintRows([line('Mild steel', '3 mm', { gradeOrSpec: 'A36' })]);
    expect(rows[0]).toMatchObject({ kind: 'heading', text: 'Mild steel A36' });
  });
});
