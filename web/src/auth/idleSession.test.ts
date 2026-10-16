import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_LOGIN_REASON,
  IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_KEY,
  idleSignOut,
  isIdle,
  msUntilIdle,
  readLastActivity,
  writeLastActivity,
} from './idleSession';

describe('idleSession timer', () => {
  it('exposes a single 30-minute timeout', () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('is not idle before the timeout elapses', () => {
    const started = 1_000_000;
    expect(isIdle(started + IDLE_TIMEOUT_MS - 1, started)).toBe(false);
    expect(msUntilIdle(started + IDLE_TIMEOUT_MS - 1, started)).toBe(1);
  });

  it('is idle exactly when the timeout elapses', () => {
    const started = 1_000_000;
    expect(isIdle(started + IDLE_TIMEOUT_MS, started)).toBe(true);
    expect(msUntilIdle(started + IDLE_TIMEOUT_MS, started)).toBe(0);
  });

  it('treats a missing last-activity time as idle', () => {
    expect(isIdle(Date.now(), 0)).toBe(true);
    expect(msUntilIdle(Date.now(), 0)).toBe(0);
  });

  it('msUntilIdle shrinks as time passes', () => {
    const started = 5_000_000;
    expect(msUntilIdle(started, started)).toBe(IDLE_TIMEOUT_MS);
    expect(msUntilIdle(started + 60_000, started)).toBe(IDLE_TIMEOUT_MS - 60_000);
  });
});

describe('idleSession storage and sign-out', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares last activity through localStorage for other tabs', () => {
    writeLastActivity(42);
    expect(store.get(LAST_ACTIVITY_KEY)).toBe('42');
    expect(readLastActivity()).toBe(42);
  });

  it('clears tokens on idle sign-out but keeps the PIN flag and offline queue', () => {
    store.set('accessToken', 'a');
    store.set('refreshToken', 'r');
    store.set('user', '{"id":"1"}');
    store.set('bmsc_has_pin', '1');
    store.set('bmsc.offlineQueue.v1', '[{"id":"q1"}]');
    store.set(LAST_ACTIVITY_KEY, '99');

    const hrefs: string[] = [];
    idleSignOut((url) => hrefs.push(url));

    expect(store.has('accessToken')).toBe(false);
    expect(store.has('refreshToken')).toBe(false);
    expect(store.has('user')).toBe(false);
    expect(store.has(LAST_ACTIVITY_KEY)).toBe(false);
    expect(store.get('bmsc_has_pin')).toBe('1');
    expect(store.get('bmsc.offlineQueue.v1')).toBe('[{"id":"q1"}]');
    expect(hrefs).toEqual([`/login?reason=${IDLE_LOGIN_REASON}`]);
  });
});
