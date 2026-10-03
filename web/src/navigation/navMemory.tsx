import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

/** Top-level sidebar / tab sections (longest prefixes first for matching). */
export const NAV_SECTIONS = [
  '/job-orders',
  '/my-assignments',
  '/worker-setup',
  '/attendance',
  '/analytics',
  '/reports',
  '/schedule',
  '/machines',
  '/work-calendar',
  '/clients',
  '/supplier-orders',
  '/suppliers',
  '/tools',
  '/users',
  '/scan',
  '/my-tools',
  '/account',
] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

const STORAGE_KEY = 'bmsc.navMemory.v1';

type Stored = {
  lastBySection: Record<string, string>;
};

function loadStored(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { lastBySection: {} };
    const parsed = JSON.parse(raw) as Stored;
    return { lastBySection: parsed.lastBySection || {} };
  } catch {
    return { lastBySection: {} };
  }
}

function saveStored(lastBySection: Record<string, string>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ lastBySection }));
  } catch {
    /* ignore quota */
  }
}

export function getNavSection(pathname: string): string | null {
  const hit = NAV_SECTIONS.find(
    (s) => pathname === s || pathname.startsWith(`${s}/`)
  );
  return hit || null;
}

type NavMemoryValue = {
  lastBySection: Record<string, string>;
  /** Bumps when the user re-clicks the active section — clears keep-alive for that section. */
  generationBySection: Record<string, number>;
  /** Resolve sidebar/tab click: same section → reset to root; else → last path or root. */
  resolveSectionNav: (sectionKey: string) => {
    to: string;
    reset: boolean;
  };
  clearSectionCache: (sectionKey: string) => void;
};

const NavMemoryContext = createContext<NavMemoryValue | null>(null);

export function NavMemoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [lastBySection, setLastBySection] = useState<Record<string, string>>(
    () => loadStored().lastBySection
  );
  const [generationBySection, setGenerationBySection] = useState<
    Record<string, number>
  >({});

  // Track wherever the user goes so sidebar return restores that URL.
  useEffect(() => {
    const section = getNavSection(location.pathname);
    if (!section) return;
    // Don't remember login or bare redirects.
    if (location.pathname === '/' || location.pathname === '/login') return;
    const full = `${location.pathname}${location.search}`;
    setLastBySection((prev) => {
      if (prev[section] === full) return prev;
      const next = { ...prev, [section]: full };
      saveStored(next);
      return next;
    });
  }, [location.pathname, location.search]);

  const clearSectionCache = useCallback((sectionKey: string) => {
    setGenerationBySection((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] || 0) + 1,
    }));
    setLastBySection((prev) => {
      const next = { ...prev, [sectionKey]: sectionKey };
      saveStored(next);
      return next;
    });
  }, []);

  const resolveSectionNav = useCallback(
    (sectionKey: string) => {
      const current = getNavSection(location.pathname);
      if (current === sectionKey) {
        clearSectionCache(sectionKey);
        return { to: sectionKey, reset: true };
      }
      const remembered = lastBySection[sectionKey];
      return {
        to: remembered && remembered.startsWith(sectionKey) ? remembered : sectionKey,
        reset: false,
      };
    },
    [location.pathname, lastBySection, clearSectionCache]
  );

  const value = useMemo(
    () => ({
      lastBySection,
      generationBySection,
      resolveSectionNav,
      clearSectionCache,
    }),
    [lastBySection, generationBySection, resolveSectionNav, clearSectionCache]
  );

  return (
    <NavMemoryContext.Provider value={value}>{children}</NavMemoryContext.Provider>
  );
}

export function useNavMemory() {
  const ctx = useContext(NavMemoryContext);
  if (!ctx) {
    throw new Error('useNavMemory must be used within NavMemoryProvider');
  }
  return ctx;
}
