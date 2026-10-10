import type { CSSProperties, ReactNode } from 'react';
import InfoTip from '../InfoTip';

/** White titled card. Never nest one inside another. */
export default function SectionCard({
  title,
  subtitle,
  info,
  extra,
  children,
  flush = false,
  className,
  style,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  info?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  /** Body without padding (tables, lists that run edge to edge). */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <section className={`ui-card${className ? ` ${className}` : ''}`} style={style} id={id}>
      {title || extra ? (
        <div className="ui-card__head">
          <div className="ui-card__titles">
            {title ? (
              <h2 className="ui-card__title">
                {title}
                {info ? <InfoTip content={info} label="How this works" /> : null}
              </h2>
            ) : null}
            {subtitle ? <div className="ui-card__subtitle">{subtitle}</div> : null}
          </div>
          {extra ? <div className="ui-card__extra">{extra}</div> : null}
        </div>
      ) : null}
      <div className={`ui-card__body${flush ? ' ui-card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}
