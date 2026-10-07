import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createActionQueue,
  syncQueue,
  type KeyValueStore,
  type NewQueuedAction,
  type QueuedAction,
  type SendResult,
} from './actionQueue';
import { overlayOperations } from './overlay';
import type { Operation } from '../types';

const posted: { url: string; body: Record<string, unknown> }[] = [];
let respond: (url: string) => Promise<unknown> = async () => ({ data: {} });

vi.mock('../api/client', () => ({
  default: {
    post: (url: string, body: Record<string, unknown>) => {
      posted.push({ url, body });
      return respond(url);
    },
  },
}));

const { classifySendError, sendAction } = await import('./sendAction');

/** Stands in for localStorage: a reload keeps the same storage. */
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

let n = 0;
function action(kind: NewQueuedAction['kind'], at: string, extra: Partial<NewQueuedAction> = {}) {
  n += 1;
  return {
    id: `action-${n}`,
    userId: 'worker-1',
    kind,
    operationId: 'op-1',
    jobOrderId: 'job-1',
    at,
    label: `${kind} Turning (JO-00001)`,
    ...extra,
  } satisfies NewQueuedAction;
}

function httpError(status: number, code?: string, message?: string) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: code ? { error: { code, message } } : {},
  });
}

beforeEach(() => {
  posted.length = 0;
  respond = async () => ({ data: {} });
});

describe('offline action queue', () => {
  it('sends actions recorded offline in order, each with the time it happened', async () => {
    const queue = createActionQueue(memoryStore());
    queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    queue.add(action('pause', '2031-03-03T01:00:00.000Z', { reason: 'BREAK' }));
    queue.add(action('resume', '2031-03-03T01:15:00.000Z'));
    queue.add(action('complete', '2031-03-03T02:00:00.000Z'));

    const result = await syncQueue(queue, 'worker-1', sendAction);

    expect(result).toEqual({ sent: 4, stoppedBy: null });
    expect(posted.map((p) => p.url)).toEqual([
      '/operations/op-1/start',
      '/operations/op-1/pause',
      '/operations/op-1/resume',
      '/operations/op-1/complete',
    ]);
    expect(posted.map((p) => p.body.timestamp)).toEqual([
      '2031-03-03T00:10:00.000Z',
      '2031-03-03T01:00:00.000Z',
      '2031-03-03T01:15:00.000Z',
      '2031-03-03T02:00:00.000Z',
    ]);
    expect(posted[1].body.reason).toBe('BREAK');
    expect(new Set(posted.map((p) => p.body.clientActionId)).size).toBe(4);
    expect(queue.list()).toEqual([]);
  });

  it('sends a breakdown with the time it was reported', async () => {
    const queue = createActionQueue(memoryStore());
    queue.add(
      action('breakdown', '2031-03-03T01:00:00.000Z', {
        machineUnitId: 'unit-9',
        category: 'MECHANICAL_FAILURE',
      })
    );
    await syncQueue(queue, 'worker-1', sendAction);
    expect(posted[0].url).toBe('/operations/machine-units/unit-9/downtime');
    expect(posted[0].body).toMatchObject({
      startedAt: '2031-03-03T01:00:00.000Z',
      category: 'MECHANICAL_FAILURE',
      operationId: 'op-1',
    });
  });

  it('keeps everything waiting while offline and resends with the same action id', async () => {
    const queue = createActionQueue(memoryStore());
    const first = queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    const second = queue.add(action('complete', '2031-03-03T02:00:00.000Z'));
    respond = async () => {
      throw new AxiosError('Network Error', 'ERR_NETWORK');
    };

    expect(await syncQueue(queue, 'worker-1', sendAction)).toEqual({ sent: 0, stoppedBy: 'offline' });
    expect(queue.list().map((a) => a.state)).toEqual(['waiting', 'waiting']);

    respond = async () => ({ data: {} });
    await syncQueue(queue, 'worker-1', sendAction);
    expect(posted.map((p) => p.body.clientActionId)).toEqual([first.id, first.id, second.id]);
    expect(queue.list()).toEqual([]);
  });

  it('stops at a refused action, keeps it for the worker, and sends nothing after it', async () => {
    const queue = createActionQueue(memoryStore());
    queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    const refused = queue.add(action('resume', '2031-03-03T01:15:00.000Z', { operationId: 'op-2' }));
    queue.add(action('complete', '2031-03-03T02:00:00.000Z'));
    respond = async (url) => {
      if (url.includes('op-2')) {
        throw httpError(409, 'MACHINE_DOWN', 'Lathe #2 is down. Ask the office before resuming.');
      }
      return { data: {} };
    };

    const result = await syncQueue(queue, 'worker-1', sendAction);

    expect(result).toEqual({ sent: 1, stoppedBy: 'refused' });
    expect(posted).toHaveLength(2);
    const [kept, behind] = queue.list();
    expect(kept.id).toBe(refused.id);
    expect(kept.state).toBe('refused');
    expect(kept.error).toEqual({
      status: 409,
      code: 'MACHINE_DOWN',
      message: 'Lathe #2 is down. Ask the office before resuming.',
    });
    expect(behind.state).toBe('waiting');

    // Nothing more is sent until the worker decides.
    expect(await syncQueue(queue, 'worker-1', sendAction)).toEqual({ sent: 0, stoppedBy: 'blocked' });
    expect(posted).toHaveLength(2);

    // Discarding it lets the rest go, in order.
    queue.remove(refused.id);
    expect(await syncQueue(queue, 'worker-1', sendAction)).toEqual({ sent: 1, stoppedBy: null });
    expect(posted.at(-1)?.url).toBe('/operations/op-1/complete');
  });

  it('sends a refused action again when the worker taps Try again', async () => {
    const queue = createActionQueue(memoryStore());
    const a = queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    respond = async () => {
      throw httpError(409, 'MATERIALS_NOT_RECEIVED', 'Materials have not arrived.');
    };
    await syncQueue(queue, 'worker-1', sendAction);
    respond = async () => ({ data: {} });
    queue.markWaiting(a.id);
    expect(queue.list()[0].error).toBeUndefined();
    expect(await syncQueue(queue, 'worker-1', sendAction)).toEqual({ sent: 1, stoppedBy: null });
  });

  it('keeps waiting and refused actions across a page reload', () => {
    const store = memoryStore();
    const before = createActionQueue(store);
    const a = before.add(action('start', '2031-03-03T00:10:00.000Z'));
    before.add(action('pause', '2031-03-03T01:00:00.000Z', { reason: 'END_OF_SHIFT' }));
    before.markRefused(a.id, { message: 'You can only update operations assigned to you' });

    const afterReload = createActionQueue(store);

    expect(afterReload.list()).toEqual(before.list());
    expect(afterReload.list().map((x) => [x.kind, x.state, x.at])).toEqual([
      ['start', 'refused', '2031-03-03T00:10:00.000Z'],
      ['pause', 'waiting', '2031-03-03T01:00:00.000Z'],
    ]);
  });

  it('keeps actions waiting when the session expired, and only sends the signed-in worker\'s', async () => {
    const queue = createActionQueue(memoryStore());
    queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    queue.add(action('start', '2031-03-03T00:20:00.000Z', { userId: 'worker-2', operationId: 'op-7' }));
    respond = async () => {
      throw httpError(401);
    };
    expect(await syncQueue(queue, 'worker-1', sendAction)).toEqual({ sent: 0, stoppedBy: 'auth' });
    expect(queue.list('worker-1')[0].state).toBe('waiting');

    respond = async () => ({ data: {} });
    await syncQueue(queue, 'worker-1', sendAction);
    expect(posted.at(-1)?.url).toBe('/operations/op-1/start');
    expect(queue.list().map((a) => a.userId)).toEqual(['worker-2']);
  });

  it('never runs two syncs at once', async () => {
    const queue = createActionQueue(memoryStore());
    queue.add(action('start', '2031-03-03T00:10:00.000Z'));
    let release!: () => void;
    const send = vi.fn(
      () => new Promise<SendResult>((resolve) => (release = () => resolve({ ok: true })))
    );
    const first = syncQueue(queue, 'worker-1', send);
    expect(await syncQueue(queue, 'worker-1', send)).toEqual({ sent: 0, stoppedBy: 'busy' });
    release();
    expect(await first).toEqual({ sent: 1, stoppedBy: null });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('classifySendError', () => {
  it('treats no reply as offline, 401 as signed out, and 5xx as a server fault', () => {
    expect(classifySendError(new AxiosError('Network Error', 'ERR_NETWORK'))).toEqual({
      ok: false,
      kind: 'offline',
    });
    expect(classifySendError(httpError(401))).toEqual({ ok: false, kind: 'auth' });
    expect(classifySendError(httpError(503))).toEqual({ ok: false, kind: 'server' });
  });

  it('treats other 4xx replies as refusals with the server\'s reason', () => {
    expect(classifySendError(httpError(403, 'FORBIDDEN', 'You can only update operations assigned to you'))).toEqual({
      ok: false,
      kind: 'refused',
      error: { status: 403, code: 'FORBIDDEN', message: 'You can only update operations assigned to you' },
    });
  });

  it('treats a wrong phone clock as a refusal the worker sees', () => {
    const message = "The phone's clock appears to be wrong. Check that automatic time is on.";
    expect(classifySendError(httpError(422, 'CLOCK_WRONG', message))).toEqual({
      ok: false,
      kind: 'refused',
      error: { status: 422, code: 'CLOCK_WRONG', message },
    });
  });
});

describe('overlayOperations', () => {
  const op = (extra: Partial<Operation> = {}): Operation =>
    ({
      id: 'op-1',
      jobOrderId: 'job-1',
      sequenceNo: 1,
      operationName: 'Turning',
      status: 'SCHEDULED',
      machineUnitId: 'unit-1',
      timeLogs: [],
      ...extra,
    }) as Operation;
  const queued = (a: NewQueuedAction, state: QueuedAction['state'] = 'waiting'): QueuedAction => ({
    ...a,
    seq: 1,
    state,
  });

  it('shows a waiting start as in progress, marked waiting to send', () => {
    const [shown] = overlayOperations([op()], [queued(action('start', '2031-03-03T00:10:00.000Z'))]);
    expect(shown.status).toBe('IN_PROGRESS');
    expect(shown.actualStart).toBe('2031-03-03T00:10:00.000Z');
    expect(shown.syncState).toBe('waiting');
  });

  it('marks the operation whose action was refused, with the reason', () => {
    const a = { ...queued(action('start', '2031-03-03T00:10:00.000Z'), 'refused'), error: { message: 'Machine is down' } };
    const [shown] = overlayOperations([op()], [a]);
    expect(shown.syncState).toBe('refused');
    expect(shown.syncError?.message).toBe('Machine is down');
  });

  it('pauses every running operation on a machine reported broken', () => {
    const running = op({ id: 'op-9', status: 'IN_PROGRESS', isPaused: false });
    const [, shown] = overlayOperations(
      [op(), running],
      [queued(action('breakdown', '2031-03-03T01:00:00.000Z', { machineUnitId: 'unit-1' }))]
    );
    expect(shown.isPaused).toBe(true);
    expect(shown.machineDown).toBe(true);
    expect(shown.timeLogs?.at(-1)?.reason).toBe('MACHINE_DOWN');
  });
});
