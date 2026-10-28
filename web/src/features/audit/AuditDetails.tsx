import type { AuditDetail } from '../../types';
import { formatAuditValue } from './auditFormat';
import './audit.css';

/** What changed: "Due date  Apr 1, 2031 → Apr 8, 2031", one line per field. */
export default function AuditDetails({ details }: { details: AuditDetail[] }) {
  if (!details.length) return <div className="audit-details__none">No other details.</div>;
  return (
    <dl className="audit-details">
      {details.map((d, i) => (
        <div className="audit-details__row" key={`${d.label}-${i}`}>
          <dt>{d.label}</dt>
          <dd>
            {'value' in d && d.value !== undefined ? (
              formatAuditValue(d.value)
            ) : (
              <>
                <span className="audit-details__old">{formatAuditValue(d.from)}</span>
                <span className="audit-details__arrow" aria-label="changed to">
                  →
                </span>
                <span className="audit-details__new">{formatAuditValue(d.to)}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
