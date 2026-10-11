import { describe, expect, it } from 'vitest';
import type { Operation } from '../../types';
import { createInboxStore, markRead, updateInbox } from './workerInbox';

const op = (id: string, extra: Partial<Operation> = {}): Operation =>
  ({
    id,
    jobOrderId: `job-${id}`,
    jobNumber: `JO-2026-${id}`,
    clientName: 'Client',
    operationName: 'Turning',
    sequenceNo: 1,
    status: 'SCHEDULED',
    ...extra,
  }) as Operation;

describe('worker inbox', () => {
  it('first look remembers what is there without alerting', () => {
    const state = updateInbox(null, [op('a'), op('b')], 't1');
    expect(state.items).toEqual([]);
    expect(Object.keys(state.known)).toEqual(['a', 'b']);
  });

  it('a newly assigned operation is an unread item', () => {
    const first = updateInbox(null, [op('a')], 't1');
    const next = updateInbox(first, [op('a'), op('b')], 't2');
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: 'assigned',
      jobOrderId: 'job-b',
      read: false,
      detail: 'JO-2026-b · Client',
    });
  });

  it('materials arriving is an item; still waiting is not', () => {
    const first = updateInbox(null, [op('a', { waitingForMaterials: true })], 't1');
    const same = updateInbox(first, [op('a', { waitingForMaterials: true })], 't2');
    expect(same).toBe(first);
    const arrived = updateInbox(first, [op('a', { waitingForMaterials: false })], 't3');
    expect(arrived.items[0].kind).toBe('materials');
  });

  it('completed operations are ignored and nothing repeats', () => {
    const first = updateInbox(null, [], 't1');
    const done = updateInbox(first, [op('a', { status: 'COMPLETED' })], 't2');
    expect(done.items).toEqual([]);
    const assigned = updateInbox(first, [op('b')], 't3');
    const again = updateInbox(assigned, [op('b')], 't4');
    expect(again.items).toHaveLength(1);
  });

  it('mark one or all as read, and survive a reload from storage', () => {
    const first = updateInbox(null, [], 't1');
    const two = updateInbox(first, [op('a'), op('b')], 't2');
    const one = markRead(two, two.items[0].id);
    expect(one.items.filter((i) => !i.read)).toHaveLength(1);
    expect(markRead(one).items.every((i) => i.read)).toBe(true);

    const mem: Record<string, string> = {};
    const store = createInboxStore({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v) });
    store.write('u1', one);
    expect(store.read('u1')).toEqual(one);
    expect(store.read('u2')).toBeNull();
  });
});
