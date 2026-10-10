import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RightOutlined } from '@ant-design/icons';
import InfoTip from '../InfoTip';

export type Crumb = { label: ReactNode; to?: string };

/** Breadcrumb trail; the last crumb is the current page and is not a link. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav className="ui-crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="ui-crumbs__item">
          {i > 0 ? <RightOutlined className="ui-crumbs__sep" aria-hidden /> : null}
          {c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/**
 * In-page header for detail and form pages: breadcrumb, title (with status
 * or chips beside it), one short subtitle, actions on the right.
 */
export default function PageHeader({
  breadcrumb,
  title,
  titleExtra,
  subtitle,
  info,
  actions,
}: {
  breadcrumb?: Crumb[];
  title: ReactNode;
  titleExtra?: ReactNode;
  subtitle?: ReactNode;
  /** Longer help text, shown behind an (i) button. */
  info?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__main">
        {breadcrumb?.length ? <Breadcrumbs items={breadcrumb} /> : null}
        <div className="ui-page-header__title-row">
          <h1 className="ui-page-header__title">{title}</h1>
          {titleExtra}
          {info ? <InfoTip content={info} label="How this works" /> : null}
        </div>
        {subtitle ? <div className="ui-page-header__subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}
