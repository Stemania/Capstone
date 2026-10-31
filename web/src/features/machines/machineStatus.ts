import type { MenuProps } from 'antd';
import dayjs from 'dayjs';
import { formatShop, shopNow, toShopDayjs } from '../../utils/shopTime';
import type { CrewMember, MachineUnitStatus } from '../../types';

export type CardStatus = 'running' | 'idle' | 'breakdown' | 'retired';

export function cardStatus(unit: MachineUnitStatus): CardStatus {
  if (unit.active === false) return 'retired';
  if (unit.down) return 'breakdown';
  if (unit.currentOperation) return 'running';
  return 'idle';
}

export function formatOpenDuration(startedAt: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - dayjs(startedAt).valueOf());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "Today, 9:00 AM", "Tomorrow, 8:00 AM", else "Oct 15, 8:00 AM". */
export function whenLabel(iso?: string | null): string {
  if (!iso) return '—';
  const d = toShopDayjs(iso);
  const today = shopNow().startOf('day');
  const day = d.startOf('day');
  const time = d.format('h:mm A');
  if (day.isSame(today, 'day')) return `Today, ${time}`;
  if (day.isSame(today.add(1, 'day'), 'day')) return `Tomorrow, ${time}`;
  if (day.isSame(today.subtract(1, 'day'), 'day')) return `Yesterday, ${time}`;
  return formatShop(iso, d.year() === today.year() ? 'MMM D, h:mm A' : 'MMM D YYYY, h:mm A');
}

/** "Today, 8:00 AM – 10:00 AM", or both dates when the window spans days. */
export function windowLabel(start?: string | null, end?: string | null): string {
  if (!start) return 'Not scheduled';
  if (!end) return whenLabel(start);
  const sameDay = toShopDayjs(start).isSame(toShopDayjs(end), 'day');
  return `${whenLabel(start)} – ${sameDay ? formatShop(end, 'h:mm A') : whenLabel(end)}`;
}

/** The person running the current operation (crew lead), if any. */
export function runningLead(unit: MachineUnitStatus): CrewMember | null {
  const cur = unit.currentOperation;
  if (!cur) return null;
  const lead = cur.crew?.find((m) => m.isLead) ?? cur.crew?.[0];
  if (lead) return lead;
  if (!cur.assignedWorkerName) return null;
  return {
    id: '',
    fullName: cur.assignedWorkerName,
    nickname: cur.assignedWorkerNickname,
    photoVersion: cur.assignedWorkerPhotoVersion,
    isLead: true,
  };
}

/** Someone other than the assigned operator is running the machine now. */
export function runnerIfOther(unit: MachineUnitStatus): CrewMember | null {
  const lead = runningLead(unit);
  if (!lead) return null;
  if (!unit.defaultOperatorId) return lead;
  if (lead.id) return lead.id === unit.defaultOperatorId ? null : lead;
  return lead.fullName === unit.defaultOperatorName ? null : lead;
}

export interface MachineActions {
  onDetails?: (unit: MachineUnitStatus) => void;
  onReport: (unit: MachineUnitStatus) => void;
  onClose: (unit: MachineUnitStatus) => void;
  onSetRepairDate: (unit: MachineUnitStatus) => void;
  onOpenSchedule: () => void;
  /** A down unit: decide what to do with the unstarted work booked on it. */
  onBreakdownWork?: (unit: MachineUnitStatus) => void;
  onOpenJob: (jobOrderId: string) => void;
  onRetire: (unit: MachineUnitStatus) => void;
  onRestore: (unit: MachineUnitStatus) => void;
  onSetDefaultOperator: (unit: MachineUnitStatus) => void;
  onClearDefaultOperator: (unit: MachineUnitStatus) => void;
}

/** The card's menu: only actions that change the machine. Details open by
 *  clicking the card, so they are not repeated here. Admin only. */
export function machineMenuItems(unit: MachineUnitStatus, actions: MachineActions): MenuProps['items'] {
  const items: NonNullable<MenuProps['items']> = [];
  if (cardStatus(unit) === 'retired') {
    items.push({ key: 'restore', label: 'Restore machine', onClick: () => actions.onRestore(unit) });
    return items;
  }
  items.push({
    key: 'defaultOp',
    label: unit.defaultOperatorId ? 'Change operator' : 'Assign operator',
    onClick: () => actions.onSetDefaultOperator(unit),
  });
  if (!unit.down) {
    items.push({ key: 'report', label: 'Report breakdown', onClick: () => actions.onReport(unit) });
  } else {
    items.push({ key: 'close', label: 'Close breakdown', onClick: () => actions.onClose(unit) });
  }
  items.push({ type: 'divider' });
  items.push({ key: 'retire', label: 'Remove machine', danger: true, onClick: () => actions.onRetire(unit) });
  return items;
}
