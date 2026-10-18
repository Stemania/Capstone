import { describe, expect, it } from 'vitest';
import { formatPoMaterialLabel, materialLineLocked } from './materialPicker';

describe('material picker (Batch 4)', () => {
  it('locks the material name once a catalog id is set', () => {
    expect(materialLineLocked(null)).toBe(false);
    expect(materialLineLocked(undefined)).toBe(false);
    expect(materialLineLocked('')).toBe(false);
    expect(materialLineLocked('cat-1')).toBe(true);
  });

  it('formats PO detail / print as name — grade — size/spec', () => {
    expect(formatPoMaterialLabel('Mild steel', 'A36', 'Ø50 × 200 mm')).toBe(
      'Mild steel — A36 — Ø50 × 200 mm'
    );
    expect(formatPoMaterialLabel('Mild steel', null, null)).toBe('Mild steel');
    expect(formatPoMaterialLabel('Mild steel', 'A36', null)).toBe('Mild steel — A36');
  });
});
