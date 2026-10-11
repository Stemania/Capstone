import { useEffect, useState } from 'react';
import { authApi } from '../../api/auth.api';
import { useAuth } from '../../hooks/useAuth';
import type { User, WorkerSkill } from '../../types';

let cached: { userId: string; me: User } | null = null;

/** The worker's own record: skills, weekly hours, assigned machines. Kept for the session. */
export function useMyProfile(online: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [me, setMe] = useState<User | null>(() => (cached && cached.userId === userId ? cached.me : null));
  const [loading, setLoading] = useState(!me);

  useEffect(() => {
    if (!userId || !online) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    authApi
      .me()
      .then(({ data }) => {
        cached = { userId, me: data };
        if (!cancelled) setMe(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, online]);

  const skills = ((me?.workerProfile?.skills || []) as (WorkerSkill | string)[])
    .filter((s): s is WorkerSkill => typeof s !== 'string')
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.proficiency - a.proficiency);

  return { me, loading, skills };
}
