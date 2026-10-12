import { describe, expect, it } from 'vitest';
import { capacityLine } from './capacityText';

const row = {
  machineTypeId: 't1',
  machineTypeCode: 'SHAPER',
  machineTypeName: 'Shaper',
  bookedHours: 46,
  workedHours: 0,
  loadHours: 46,
  availableHours: 48,
  units: 1,
  unitsDown: 0,
  loadPct: 95.8,
};

describe('capacityLine', () => {
  it('shows the numbers behind the percentage', () => {
    expect(capacityLine(row)).toBe(
      'Shaper 95.8%: 46 h booked − 0 h worked = 46 h of 48 h available (1 unit)',
    );
  });

  it('says how many units are down', () => {
    expect(
      capacityLine({ ...row, machineTypeName: 'Lathe', units: 2, unitsDown: 1, workedHours: 3.5, loadHours: 42.5 }),
    ).toBe('Lathe 95.8%: 46 h booked − 3.5 h worked = 42.5 h of 48 h available (1 of 2 units, 1 down)');
  });
});
