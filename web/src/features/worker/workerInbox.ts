/**
 * Worker notifications, worked out on the phone from the worker's own
 * assignment list: a new operation assigned, or materials arriving for one.
 * Nothing new is asked of the server.
 */

import type { Operation } from '../../types';
import type { KeyValueStore } from '../../offline/actionQueue';

export interface InboxItem {
  id: string;
  kind: 'assigned' | 'materials';
  title: string;
  detail: string;
  at: string;
  jobOrderId: string;
  read: boolean;
}

export interface InboxState {
  /** Open operations last seen, and whether each was waiting for materials. */
  known: Record<string, { waiting: boolean }>;
  items: InboxItem[];
}

const MAX_ITEMS = 30;

function opTitle(op: Operation) {
  const name = op.operationName || op.name || 'Operation';
  return op.sequenceNo != null ? `Op ${op.sequenceNo} · ${name}` : name;
}

/** The first look only remembers what is there, so a fresh sign-in is not a wall of alerts. */
export function updateInbox(prev: InboxState | null, ops: Operation[], now: string): InboxState {
  const open = ops.filter((o) => o.status !== 'COMPLETED');
  const known: InboxState['known'] = {};
  for (const op of open) known[op.id] = { waiting: Boolean(op.waitingForMaterials) };
  if (!prev) return { known, items: [] };

  const fresh: InboxItem[] = [];
  for (const op of open) {
    const before = prev.known[op.id];
    const where = [op.jobNumber, op.clientName].filter(Boolean).join(' · ');
    if (!before) {
      fresh.push({
        id: `assigned:${op.id}`,
        kind: 'assigned',
        title: `New: ${opTitle(op)}`,
        detail: where,
        at: now,
        jobOrderId: op.jobOrderId,
        read: false,
      });
    } else if (before.waiting && !op.waitingForMaterials) {
      fresh.push({
        id: `materials:${op.id}:${now}`,
        kind: 'materials',
        title: `Materials arrived: ${opTitle(op)}`,
        detail: where,
        at: now,
        jobOrderId: op.jobOrderId,
        read: false,
      });
    }
  }

  const sameKnown =
    Object.keys(known).length === Object.keys(prev.known).length &&
    Object.entries(known).every(([id, k]) => prev.known[id]?.waiting === k.waiting);
  if (!fresh.length && sameKnown) return prev;
  const seen = new Set(fresh.map((i) => i.id));
  return {
    known,
    items: [...fresh, ...prev.items.filter((i) => !seen.has(i.id))].slice(0, MAX_ITEMS),
  };
}

export function markRead(state: InboxState, id?: string): InboxState {
  return {
    ...state,
    items: state.items.map((i) => (id === undefined || i.id === id ? { ...i, read: true } : i)),
  };
}

const PREFIX = 'bmsc.workerInbox.v1.';

export function createInboxStore(store: KeyValueStore) {
  return {
    read(userId: string): InboxState | null {
      try {
        const raw = store.getItem(PREFIX + userId);
        return raw ? (JSON.parse(raw) as InboxState) : null;
      } catch {
        return null;
      }
    },
    write(userId: string, state: InboxState) {
      try {
        store.setItem(PREFIX + userId, JSON.stringify(state));
      } catch {
        /* storage full: notifications are a convenience */
      }
    },
  };
}

export const inboxStore = createInboxStore(
  typeof localStorage === 'undefined' ? { getItem: () => null, setItem: () => {} } : localStorage
);
