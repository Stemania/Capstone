import dayjs from 'dayjs';
import type { Tone } from '../../theme/tokens';
import { shopToday } from '../../utils/shopTime';
import type { Operation } from '../../types';

export function isOverdue(op: Pick<Operation, 'status' | 'dueDate'>): boolean {
  return Boolean(op.status !== 'COMPLETED' && op.dueDate && dayjs(op.dueDate).isBefore(shopToday(), 'day'));
}

/** One label per operation for worker lists: the most urgent thing first. */
export function opStatusPill(
  op: Pick<Operation, 'status' | 'dueDate' | 'isPaused' | 'waitingForMaterials'>
): { tone: Tone; label: string } {
  if (op.waitingForMaterials && op.status !== 'COMPLETED' && op.status !== 'IN_PROGRESS') {
    return { tone: 'amber', label: 'Waiting for materials' };
  }
  if (isOverdue(op)) return { tone: 'red', label: 'Overdue' };
  switch (op.status) {
    case 'IN_PROGRESS':
      return op.isPaused ? { tone: 'amber', label: 'Paused' } : { tone: 'blue', label: 'In progress' };
    case 'COMPLETED':
      return { tone: 'green', label: 'Completed' };
    case 'SCHEDULED':
      return { tone: 'indigo', label: 'Scheduled' };
    case 'REWORK':
      return { tone: 'amber', label: 'Redo' };
    default:
      return { tone: 'slate', label: 'Pending' };
  }
}

export function opTitle(op: Pick<Operation, 'sequenceNo' | 'operationName' | 'name'>): string {
  const name = op.operationName || op.name || 'Operation';
  return op.sequenceNo != null ? `Op ${op.sequenceNo} · ${name}` : name;
}

export function machineLabel(op: Pick<Operation, 'machineUnitLabel' | 'machineTypeName' | 'machineNames'>) {
  return op.machineUnitLabel || op.machineTypeName || op.machineNames?.[0] || null;
}
