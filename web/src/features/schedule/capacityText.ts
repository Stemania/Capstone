import type { MachineCapacityRow } from '../../api/schedule.api';

const h = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

/** "Shaper 95.8%: 46 h booked − 0 h worked = 46 h of 48 h available (1 unit)". */
export function capacityLine(c: MachineCapacityRow): string {
  const name = c.machineTypeName || c.machineTypeCode;
  const units =
    c.unitsDown > 0
      ? `${c.units - c.unitsDown} of ${c.units} units, ${c.unitsDown} down`
      : `${c.units} unit${c.units === 1 ? '' : 's'}`;
  return (
    `${name} ${c.loadPct}%: ${h(c.bookedHours)} booked − ${h(c.workedHours)} worked = ` +
    `${h(c.loadHours)} of ${h(c.availableHours)} available (${units})`
  );
}
