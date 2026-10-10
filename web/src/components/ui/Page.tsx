import type { ReactNode } from 'react';

/**
 * Page root. Its children sit on the grey page background as separate cards
 * (SectionCard). Pages not wrapped in <Page> still get one white surface.
 */
export default function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ui-page${className ? ` ${className}` : ''}`}>{children}</div>;
}
