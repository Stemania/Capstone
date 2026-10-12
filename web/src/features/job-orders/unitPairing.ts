import type { FasterUnitSuggestion, MachineUnitInfo } from '../../types';

const firstName = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';

/** "Ben" for a unit's assigned operator, or null when it has none. */
export function unitOwnerName(unit: MachineUnitInfo): string | null {
  if (!unit.defaultOperatorId) return null;
  return unit.defaultOperatorNickname || firstName(unit.defaultOperatorName) || 'another operator';
}

/** "Lathe #5", or "Lathe #4 · Ben's unit" when the unit is another operator's. */
export function unitPairText(unit: MachineUnitInfo | undefined, leadId?: string | null): string | null {
  if (!unit) return null;
  if (!unit.defaultOperatorId || unit.defaultOperatorId === leadId) return unit.label;
  return `${unit.label} · ${unitOwnerName(unit)}'s unit`;
}

/**
 * "Lathe #4 (Ben's unit) is free 7 h earlier · job finishes Oct 14 instead of Oct 21".
 * ``fmtDate`` formats an ISO time as a short shop date.
 */
export function fasterUnitText(f: FasterUnitSuggestion, fmtDate: (iso: string) => string): string {
  const label = f.machineUnitLabel || 'Another unit';
  const owner = f.ownership === 'OTHER' && f.operatorName ? ` (${firstName(f.operatorName)}'s unit)` : '';
  const free =
    f.hoursEarlier != null && f.hoursEarlier > 0
      ? `is free ${Number.isInteger(f.hoursEarlier) ? f.hoursEarlier : f.hoursEarlier.toFixed(1)} h earlier`
      : 'is free';
  const finish = f.currentProjectedCompletion
    ? `job finishes ${fmtDate(f.projectedCompletion)} instead of ${fmtDate(f.currentProjectedCompletion)}`
    : `job can finish ${fmtDate(f.projectedCompletion)}; the saved unit has no time for it`;
  return `${label}${owner} ${free} · ${finish}`;
}

/**
 * The unit a newly picked lead works on: the suggested unit when it is theirs
 * or open, else their own unit, else an open unit, else the suggested unit
 * (another operator's, shown labelled).
 */
export function pairedUnitId(
  workerId: string,
  machineTypeId: string | null | undefined,
  units: MachineUnitInfo[],
  suggestedUnitId?: string | null,
): string | undefined {
  if (!machineTypeId) return undefined;
  const ofType = units
    .filter((u) => u.machineTypeId === machineTypeId && u.active !== false)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const suggested = suggestedUnitId ? ofType.find((u) => u.id === suggestedUnitId) : undefined;
  if (suggested && (!suggested.defaultOperatorId || suggested.defaultOperatorId === workerId)) {
    return suggested.id;
  }
  const own = ofType.find((u) => u.defaultOperatorId === workerId);
  if (own) return own.id;
  return ofType.find((u) => !u.defaultOperatorId)?.id ?? suggested?.id;
}
