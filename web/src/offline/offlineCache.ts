/**
 * The worker's assignments and their job pages (with instructions), kept on
 * the phone and refreshed whenever online, so they still open offline.
 */

import type { JobOrder, Operation } from '../types';
import type { KeyValueStore } from './actionQueue';

interface CachedData {
  updatedAt: string | null;
  mine: Operation[] | null;
  jobs: Record<string, JobOrder>;
}

const PREFIX = 'bmsc.offlineData.v1.';

export function createOfflineCache(store: KeyValueStore & { removeItem(key: string): void }) {
  const read = (userId: string): CachedData => {
    try {
      const raw = store.getItem(PREFIX + userId);
      if (raw) return JSON.parse(raw) as CachedData;
    } catch {
      /* fall through */
    }
    return { updatedAt: null, mine: null, jobs: {} };
  };
  const write = (userId: string, data: CachedData) => {
    try {
      store.setItem(PREFIX + userId, JSON.stringify(data));
    } catch {
      /* storage full: keep working online */
    }
  };

  return {
    read,
    saveMine(userId: string, mine: Operation[]) {
      const data = read(userId);
      const keep = new Set(mine.map((o) => o.jobOrderId));
      const jobs = Object.fromEntries(Object.entries(data.jobs).filter(([id]) => keep.has(id)));
      write(userId, { mine, jobs, updatedAt: new Date().toISOString() });
    },
    saveJob(userId: string, job: JobOrder) {
      const data = read(userId);
      write(userId, { ...data, jobs: { ...data.jobs, [job.id]: job } });
    },
    clear(userId: string) {
      store.removeItem(PREFIX + userId);
    },
  };
}

export const offlineCache = createOfflineCache(
  typeof localStorage === 'undefined'
    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    : localStorage
);
