import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Job # / PO # in monospace with a subtle chip, so IDs scan easily. */
export default function IdChip({
  children,
  to,
  onClick,
  title,
}: {
  children: ReactNode;
  to?: string;
  onClick?: (e: MouseEvent) => void;
  title?: string;
}) {
  if (to) {
    return (
      <Link to={to} className="ui-id" title={title} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <span className="ui-id" title={title}>
      {children}
    </span>
  );
}
