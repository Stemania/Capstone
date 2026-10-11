import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
});

const { default: apiClient } = await import('./client');
const { createActionQueue, syncQueue, QUEUE_KEY } = await import('../offline/actionQueue');
const { sendAction } = await import('../offline/sendAction');

const location = { href: '' };
vi.stubGlobal('window', { location });

type Reply = { status: number; data?: unknown };
type Seen = { url: string; auth?: string; body?: unknown };

function reply(config: InternalAxiosRequestConfig, r: Reply) {
  const response = { status: r.status, statusText: '', headers: {}, config, data: r.data ?? {} };
  if (r.status >= 400) {
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response);
  }
  return response;
}

/** Routes every request (app calls and the raw refresh call) through `handle`. */
function serve(handle: (seen: Seen) => Reply) {
  const seen: Seen[] = [];
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const headers = AxiosHeaders.from(config.headers);
    const s: Seen = {
      url: config.url || '',
      auth: headers.get('Authorization')?.toString(),
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    };
    seen.push(s);
    return reply(config, handle(s));
  };
  apiClient.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
  return seen;
}

function signIn(access = 'a1', refresh = 'r1') {
  data.set('accessToken', access);
  data.set('refreshToken', refresh);
  data.set('user', JSON.stringify({ id: 'worker-1' }));
}

const signedOut = { status: 401, data: { error: { code: 'DEVICE_SIGNED_OUT' } } };

function queueTwoActions() {
  const queue = createActionQueue(localStorage, QUEUE_KEY);
  for (const kind of ['start', 'complete'] as const) {
    queue.add({
      id: `act-${kind}`,
      userId: 'worker-1',
      kind,
      operationId: 'op-1',
      jobOrderId: 'job-1',
      at: '2026-10-11T01:00:00Z',
      label: `${kind} Turning`,
    });
  }
  return queue;
}

beforeEach(() => {
  data.clear();
  data.set('bmsc_device_id', 'dev-123');
  location.href = '';
});

describe('device-bound sessions', () => {
  it('a signed-out device goes to login without a refresh and keeps its waiting actions', async () => {
    signIn();
    data.set('bmsc_has_pin', '1');
    queueTwoActions();
    const seen = serve(() => signedOut);

    await expect(apiClient.get('/operations/mine')).rejects.toBeInstanceOf(AxiosError);

    expect(seen.map((s) => s.url)).toEqual(['/operations/mine']);
    expect(location.href).toBe('/login?reason=signed-out');
    expect(data.has('accessToken')).toBe(false);
    expect(data.has('refreshToken')).toBe(false);
    expect(data.has('bmsc_has_pin')).toBe(false);
    expect(createActionQueue(localStorage).list('worker-1')).toHaveLength(2);
    expect(data.get('bmsc_device_id')).toBe('dev-123');
  });

  it('refresh sends this device and keeps an upgraded refresh token', async () => {
    signIn('old-access', 'old-refresh');
    const seen = serve((s) => {
      if (s.url.endsWith('/auth/refresh')) return { status: 200, data: { accessToken: 'a2', refreshToken: 'r2' } };
      return s.auth === 'Bearer a2' ? { status: 200, data: { ok: true } } : { status: 401 };
    });

    const res = await apiClient.get('/auth/me');

    expect(res.data).toEqual({ ok: true });
    const refresh = seen.find((s) => s.url.endsWith('/auth/refresh'));
    expect(refresh?.auth).toBe('Bearer old-refresh');
    expect(refresh?.body).toEqual({ deviceId: 'dev-123' });
    expect(data.get('accessToken')).toBe('a2');
    expect(data.get('refreshToken')).toBe('r2');
    expect(location.href).toBe('');
  });

  it('an ended session keeps waiting actions, and they are sent after signing in again', async () => {
    signIn();
    const queue = queueTwoActions();
    serve((s) =>
      s.url.endsWith('/auth/refresh')
        ? { status: 401, data: { error: { code: 'SESSION_EXPIRED' } } }
        : { status: 401 }
    );

    const first = await syncQueue(queue, 'worker-1', sendAction);

    expect(first).toEqual({ sent: 0, stoppedBy: 'auth' });
    expect(location.href).toBe('/login?reason=expired');
    expect(queue.list('worker-1').map((a) => a.state)).toEqual(['waiting', 'waiting']);

    signIn('fresh-access', 'fresh-refresh');
    const posted = serve((s) => (s.auth === 'Bearer fresh-access' ? { status: 200 } : { status: 401 }));
    const second = await syncQueue(queue, 'worker-1', sendAction);

    expect(second).toEqual({ sent: 2, stoppedBy: null });
    expect(posted.map((s) => s.url)).toEqual(['/operations/op-1/start', '/operations/op-1/complete']);
    expect(queue.list('worker-1')).toHaveLength(0);
  });
});
