import { useOutlet, useLocation } from 'react-router-dom';
import { useRef, type ReactNode } from 'react';
import { getNavSection, useNavMemory } from './navMemory';

type CacheEntry = {
  path: string;
  generation: number;
  element: ReactNode;
};

/**
 * Keeps one mounted page per nav section when you leave via the sidebar.
 * Re-clicking the active section bumps generation and drops that cache.
 */
export default function KeepAliveOutlet() {
  const outlet = useOutlet();
  const location = useLocation();
  const { generationBySection } = useNavMemory();
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const section = getNavSection(location.pathname);
  const fullPath = `${location.pathname}${location.search}`;
  const generation = section ? generationBySection[section] || 0 : 0;

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

    if (!sameFrozenPage) {
      cacheRef.current.set(section, {
        path: fullPath,
        generation,
        element: outlet,
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
            {entry.element}
          </div>
        );
      })}
    </>
  );
}
