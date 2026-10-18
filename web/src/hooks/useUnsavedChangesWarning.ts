import { useEffect } from 'react';

const CONFIRM = 'You have unsaved changes. Leave without saving?';

/**
 * Unsaved-changes warning that works with BrowserRouter (no data router).
 * - beforeunload for tab close / refresh
 * - capture-phase click on same-origin in-app links
 * - popstate (browser back/forward) with a soft confirm
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      if (!window.confirm(CONFIRM)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onPopState = () => {
      if (!window.confirm(CONFIRM)) {
        // Stay on the current URL after a cancelled back/forward.
        window.history.pushState(null, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [dirty]);
}
