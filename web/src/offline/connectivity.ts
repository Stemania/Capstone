/**
 * Whether the server can be reached. navigator.onLine alone says "online" on
 * shop Wi-Fi with no internet, so failed and successful requests also count,
 * and while offline the server is checked every 15 seconds.
 */

import axios from 'axios';
import { useSyncExternalStore } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const PROBE_MS = 15_000;

let online = typeof navigator === 'undefined' ? true : navigator.onLine;
const listeners = new Set<() => void>();
let probeTimer: number | null = null;

function set(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => fn());
  if (online) stopProbe();
  else startProbe();
}

async function probe() {
  try {
    await axios.get(`${API_BASE}/auth/me`, { timeout: 8000, validateStatus: () => true });
    set(true);
  } catch {
    /* still offline */
  }
}

function startProbe() {
  if (probeTimer != null || typeof window === 'undefined') return;
  probeTimer = window.setInterval(probe, PROBE_MS);
}

function stopProbe() {
  if (probeTimer != null) window.clearInterval(probeTimer);
  probeTimer = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void probe());
  window.addEventListener('offline', () => set(false));
  if (!online) startProbe();
}

export const connectivity = {
  isOnline: () => online,
  reportReachable: () => set(true),
  reportUnreachable: () => set(false),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useOnline(): boolean {
  return useSyncExternalStore(connectivity.subscribe, connectivity.isOnline);
}
