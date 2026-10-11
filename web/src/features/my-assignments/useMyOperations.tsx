import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { useOfflineOptional } from '../../offline/OfflineProvider';
import { offlineCache } from '../../offline/offlineCache';
import { overlayOperations, type OverlaidOperation } from '../../offline/overlay';
import type { QueuedAction } from '../../offline/actionQueue';
import type { Operation } from '../../types';

const POLL_MS = 60_000;
const NO_PENDING: QueuedAction[] = [];

export interface MyOperations {
  /** As the server (or the phone's copy) last gave them. */
  loaded: Operation[];
  /** With this phone's waiting actions applied. */
  operations: OverlaidOperation[];
  loading: boolean;
  error: string;
  reload: () => void;
}

const MyOperationsContext = createContext<MyOperations | null>(null);

function useMyOperationsSource(enabled: boolean): MyOperations {
  const offline = useOfflineOptional();
  const online = offline?.online ?? true;
  const userId = offline?.userId ?? null;
  const version = offline?.version ?? 0;
  const pending = offline?.pending ?? NO_PENDING;
  const [loaded, setLoaded] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    const fromPhone = () => offlineCache.read(userId).mine;
    if (!online) {
      const saved = fromPhone();
      if (saved) setLoaded(saved);
      else setError('No assignments saved on this phone yet. Connect once to download them.');
      setLoading(false);
      return;
    }
    operationsApi
      .mine()
      .then(({ data }) => {
        if (cancelled) return;
        offlineCache.saveMine(userId, data);
        setLoaded(data);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        const saved = axios.isAxiosError(err) && !err.response ? fromPhone() : null;
        if (saved) setLoaded(saved);
        else setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, online, userId, version, tick]);

  useEffect(() => {
    if (!enabled || !online) return;
    const id = window.setInterval(reload, POLL_MS);
    window.addEventListener('focus', reload);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', reload);
    };
  }, [enabled, online, reload]);

  const operations = useMemo(() => overlayOperations(loaded, pending), [loaded, pending]);
  return useMemo(
    () => ({ loaded, operations, loading, error, reload }),
    [loaded, operations, loading, error, reload]
  );
}

/** One copy of the worker's assignments for every tab and the notification bell. */
export function MyOperationsProvider({ children }: { children: ReactNode }) {
  const value = useMyOperationsSource(true);
  return <MyOperationsContext.Provider value={value}>{children}</MyOperationsContext.Provider>;
}

/** The shared copy inside the worker app; loads its own elsewhere (Admin's My assignments). */
export function useMyOperations(): MyOperations {
  const shared = useContext(MyOperationsContext);
  const own = useMyOperationsSource(!shared);
  return shared ?? own;
}

export function useMyOperationsOptional(): MyOperations | null {
  return useContext(MyOperationsContext);
}
