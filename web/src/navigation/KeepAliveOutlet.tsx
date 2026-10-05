import { useOutlet, useLocation, UNSAFE_LocationContext } from 'react-router-dom';
import { useContext, useRef, type ContextType, type ReactNode } from 'react';
import { getNavSection, useNavMemory } from './navMemory';

type LocationContextValue = ContextType<typeof UNSAFE_LocationContext>;

type CacheEntry = {
  path: string;
  generation: number;
  element: ReactNode;
  locationContext: LocationContextValue;
};

/**
 * Keeps one mounted page per nav section when you leave via the sidebar.
 * Re-clicking the active section bumps generation and drops that cache.
 *
 * Hidden pages see the location they last showed, not the live one, so
 * navigating elsewhere does not re-render them (useNavigate, useLocation and
 * useSearchParams all read this context). UNSAFE_LocationContext is outside
 * React Router's public API; react-router-dom is pinned to exactly 7.18.1 in
 * package.json so an upgrade can't change it unnoticed. Re-check this file
 * before bumping that version.
 */
export default function KeepAliveOutlet() {
  const outlet = useOutlet();
  const location = useLocation();
  const liveLocationContext = useContext(UNSAFE_LocationContext);
  const { generationBySection, isDenied } = useNavMemory();
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const section = getNavSection(location.pathname);
  const fullPath = `${location.pathname}${location.search}`;
  const generation = section ? generationBySection[section] || 0 : 0;

  for (const [key, entry] of cacheRef.current) {
    if (isDenied(entry.path)) cacheRef.current.delete(key);
  }

  if (section) {
    const existing = cacheRef.current.get(section);
    if (existing && existing.generation !== generation) {
      cacheRef.current.delete(section);
    }
  }

  if (section && outlet) {
    const cached = cacheRef.current.get(section);
    const sameFrozenPage =
      cached &&
      cached.generation === generation &&
      cached.path === fullPath;

    if (sameFrozenPage) {
      cached.locationContext = liveLocationContext;
    } else {
      cacheRef.current.set(section, {
        path: fullPath,
        generation,
        element: outlet,
        locationContext: liveLocationContext,
      });
    }
  }

  if (!section) {
    return <>{outlet}</>;
  }

  const entries = [...cacheRef.current.entries()];

  return (
    <>
      {entries.map(([key, entry]) => {
        const active = key === section && entry.path === fullPath;
        return (
          <div
            key={`${key}::${entry.generation}`}
            className={active ? 'nav-keep-alive nav-keep-alive--active' : 'nav-keep-alive'}
            style={{ display: active ? 'block' : 'none', minHeight: active ? '100%' : undefined }}
            aria-hidden={!active}
          >
            <UNSAFE_LocationContext.Provider value={entry.locationContext}>
              {entry.element}
            </UNSAFE_LocationContext.Provider>
          </div>
        );
      })}
    </>
  );
}
