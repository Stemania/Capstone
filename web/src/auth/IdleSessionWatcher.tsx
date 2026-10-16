import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LAST_ACTIVITY_KEY,
  activityEventNames,
  idleSignOut,
  isIdle,
  msUntilIdle,
  readLastActivity,
  writeLastActivity,
} from './idleSession';

/** How often a busy tab may rewrite the shared last-activity timestamp. */
const WRITE_THROTTLE_MS = 1000;

/**
 * While signed in, tracks activity and signs out after the shared idle timeout.
 * Last activity is stored in localStorage so other tabs of this app stay signed
 * in when this tab is used.
 */
export default function IdleSessionWatcher() {
  const { user } = useAuth();
  const location = useLocation();
  const lastWriteRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signedOutRef = useRef(false);

  useEffect(() => {
    if (!user) {
      signedOutRef.current = false;
      return;
    }

    signedOutRef.current = false;

    const clearTimer = () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const signOut = () => {
      if (signedOutRef.current) return;
      signedOutRef.current = true;
      clearTimer();
      idleSignOut();
    };

    const arm = () => {
      clearTimer();
      if (signedOutRef.current) return;
      const now = Date.now();
      const last = readLastActivity() ?? now;
      const wait = msUntilIdle(now, last);
      if (wait <= 0) {
        signOut();
        return;
      }
      timerRef.current = setTimeout(() => {
        const latest = readLastActivity() ?? 0;
        if (isIdle(Date.now(), latest)) signOut();
        else arm();
      }, wait);
    };

    const noteActivity = (force = false) => {
      if (signedOutRef.current) return;
      const now = Date.now();
      if (!force && now - lastWriteRef.current < WRITE_THROTTLE_MS) {
        arm();
        return;
      }
      lastWriteRef.current = now;
      writeLastActivity(now);
      arm();
    };

    noteActivity(true);

    const onActivity = () => noteActivity(false);
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const name of activityEventNames()) {
      window.addEventListener(name, onActivity, opts);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') noteActivity(true);
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY) return;
      if (event.newValue == null) {
        // Another tab already idle-signed-out and cleared the shared stamp.
        signOut();
        return;
      }
      arm();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      clearTimer();
      for (const name of activityEventNames()) {
        window.removeEventListener(name, onActivity, opts);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    writeLastActivity(Date.now());
  }, [user, location.pathname, location.search]);

  return null;
}
