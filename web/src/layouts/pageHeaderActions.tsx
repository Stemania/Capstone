import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type Ctx = {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
};

const PageHeaderActionsContext = createContext<Ctx | null>(null);

/** Lets a page put controls in the app topbar (same row as the page title). */
export function PageHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<ReactNode>(null);
  const setActions = useCallback((node: ReactNode) => {
    setActionsState(node);
  }, []);
  const value = useMemo(() => ({ actions, setActions }), [actions, setActions]);
  return (
    <PageHeaderActionsContext.Provider value={value}>{children}</PageHeaderActionsContext.Provider>
  );
}

export function usePageHeaderActionsSlot(): ReactNode {
  return useContext(PageHeaderActionsContext)?.actions ?? null;
}

/** Register header actions for this page; cleared on unmount. */
export function usePageHeaderActions(node: ReactNode) {
  const ctx = useContext(PageHeaderActionsContext);
  useLayoutEffect(() => {
    if (!ctx) return;
    ctx.setActions(node);
    return () => ctx.setActions(null);
  }, [ctx, node]);
}
