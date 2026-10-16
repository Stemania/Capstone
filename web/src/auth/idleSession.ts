/** Idle sign-out: one timeout for the office web app and the worker PWA. */

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Shared across tabs so activity in one tab keeps the others signed in. */
export const LAST_ACTIVITY_KEY = 'bmsc.lastActivity';

export const IDLE_LOGIN_REASON = 'idle';

export const IDLE_SIGN_OUT_MESSAGE =
  'You were signed out after 30 minutes of inactivity.';

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'touchmove',
  'scroll',
  'wheel',
] as const;

export type ActivityEventName = (typeof ACTIVITY_EVENTS)[number];

export function activityEventNames(): readonly ActivityEventName[] {
  return ACTIVITY_EVENTS;
}

export function isIdle(
  nowMs: number,
  lastActivityMs: number,
  timeoutMs: number = IDLE_TIMEOUT_MS,
): boolean {
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0) return true;
  return nowMs - lastActivityMs >= timeoutMs;
}

/** Milliseconds until idle at `nowMs`, or 0 if already idle. */
export function msUntilIdle(
  nowMs: number,
  lastActivityMs: number,
  timeoutMs: number = IDLE_TIMEOUT_MS,
): number {
  if (isIdle(nowMs, lastActivityMs, timeoutMs)) return 0;
  return timeoutMs - (nowMs - lastActivityMs);
}

export function readLastActivity(storage: Storage = localStorage): number | null {
  const raw = storage.getItem(LAST_ACTIVITY_KEY);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function writeLastActivity(
  atMs: number,
  storage: Storage = localStorage,
): void {
  storage.setItem(LAST_ACTIVITY_KEY, String(atMs));
}

/**
 * Clears session tokens and sends the browser to login with the idle reason.
 * Keeps `bmsc_has_pin` and the offline action queue so PIN unlock and sync still work.
 */
export function idleSignOut(assignHref: (url: string) => void = (url) => {
  window.location.href = url;
}): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  assignHref(`/login?reason=${IDLE_LOGIN_REASON}`);
}
