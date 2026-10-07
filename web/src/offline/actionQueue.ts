/**
 * Worker actions recorded on the phone while it cannot reach the server.
 *
 * Kept in localStorage (survives closing the app and restarting the phone),
 * sent oldest first, one at a time. An action leaves the queue only when the
 * server accepts it or the worker discards it; a refusal stops the queue so
 * later actions are not sent out of order.
 */

import type { OperationPauseReason } from '../types';

export type OfflineActionKind = 'start' | 'pause' | 'resume' | 'complete' | 'breakdown';

export interface QueuedActionError {
  code?: string;
  message: string;
  status?: number;
}

export interface QueuedAction {
  /** Sent as clientActionId, so a resent action is recorded once. */
  id: string;
  seq: number;
  userId: string;
  kind: OfflineActionKind;
  operationId: string;
  jobOrderId: string;
  /** When it happened on the phone (ISO, UTC). */
  at: string;
  reason?: OperationPauseReason;
  machineUnitId?: string;
  category?: string;
  note?: string;
  /** What the worker sees, e.g. "Start Turning (JO-00012)". */
  label: string;
  state: 'waiting' | 'refused';
  error?: QueuedActionError;
}

export type NewQueuedAction = Omit<QueuedAction, 'seq' | 'state' | 'error'>;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_KEY = 'bmsc.offlineQueue.v1';

export type SendResult =
  | { ok: true }
  | { ok: false; kind: 'refused'; error: QueuedActionError }
  | { ok: false; kind: 'offline' | 'auth' | 'server' };

export type SyncStop = 'refused' | 'blocked' | 'offline' | 'auth' | 'server' | 'busy' | null;

export interface ActionQueue {
  list(userId?: string): QueuedAction[];
  add(action: NewQueuedAction): QueuedAction;
  remove(id: string): void;
  markRefused(id: string, error: QueuedActionError): void;
  markWaiting(id: string): void;
  subscribe(listener: () => void): () => void;
  /** Re-read after another tab changed the queue. */
  reload(): void;
  syncing: boolean;
}

export function createActionQueue(store: KeyValueStore, key = QUEUE_KEY): ActionQueue {
  const listeners = new Set<() => void>();

  const read = (): QueuedAction[] => {
    try {
      const raw = store.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (items: QueuedAction[]) => {
    store.setItem(key, JSON.stringify(items));
    listeners.forEach((fn) => fn());
  };
  const update = (id: string, change: (a: QueuedAction) => QueuedAction) =>
    write(read().map((a) => (a.id === id ? change(a) : a)));

  return {
    syncing: false,
    list(userId) {
      const items = read().sort((a, b) => a.seq - b.seq);
      return userId ? items.filter((a) => a.userId === userId) : items;
    },
    add(action) {
      const items = read();
      const seq = items.reduce((m, a) => Math.max(m, a.seq), 0) + 1;
      const item: QueuedAction = { ...action, seq, state: 'waiting' };
      write([...items, item]);
      return item;
    },
    remove(id) {
      write(read().filter((a) => a.id !== id));
    },
    markRefused(id, error) {
      update(id, (a) => ({ ...a, state: 'refused', error }));
    },
    markWaiting(id) {
      update(id, (a) => {
        const next = { ...a, state: 'waiting' as const };
        delete next.error;
        return next;
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload() {
      listeners.forEach((fn) => fn());
    },
  };
}

/**
 * Send the worker's waiting actions, oldest first, one at a time. Stops at the
 * first refusal (kept, shown to the worker), at an earlier refusal still
 * waiting for the worker ("blocked"), or when the server cannot be reached or
 * the session has expired (the action stays waiting).
 */
export async function syncQueue(
  queue: ActionQueue,
  userId: string,
  send: (action: QueuedAction) => Promise<SendResult>
): Promise<{ sent: number; stoppedBy: SyncStop }> {
  if (queue.syncing) return { sent: 0, stoppedBy: 'busy' };
  queue.syncing = true;
  let sent = 0;
  try {
    for (;;) {
      const next = queue.list(userId)[0];
      if (!next) return { sent, stoppedBy: null };
      if (next.state === 'refused') return { sent, stoppedBy: 'blocked' };
      const result = await send(next);
      if (result.ok) {
        queue.remove(next.id);
        sent += 1;
        continue;
      }
      if (result.kind === 'refused') {
        queue.markRefused(next.id, result.error);
        return { sent, stoppedBy: 'refused' };
      }
      return { sent, stoppedBy: result.kind };
    }
  } finally {
    queue.syncing = false;
  }
}
