import { useEffect, useState } from 'react';
import { Button, Spin, Typography } from 'antd';
import { auditApi } from '../../api/audit.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import type { AuditEntry } from '../../types';
import { formatShop } from '../../utils/shopTime';
import AuditDetails from './AuditDetails';
import { actionTone, roleLabel } from './auditFormat';
import './audit.css';

const FIRST = 15;

/** Admin only: every recorded change to this job, its operations, time entries, purchases, and invoice. */
export default function JobAuditHistory({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    auditApi
      .jobHistory(jobId)
      .then(({ data }) => alive && setItems(data.items))
      .catch((err) => alive && setError(getErrorMessage(err)));
    return () => {
      alive = false;
    };
  }, [jobId]);

  if (error) return <Typography.Text type="danger" style={{ fontSize: 12 }}>{error}</Typography.Text>;
  if (!items) return <Spin size="small" />;
  if (!items.length) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        No changes recorded for this job yet.
      </Typography.Text>
    );
  }
  const shown = showAll ? items : items.slice(0, FIRST);
  return (
    <div>
      {shown.map((e) => (
        <div className="audit-history__row" key={e.id}>
          <div className="audit-history__meta">
            <StatusPill tone={actionTone(e.action)} compact>
              {e.actionLabel}
            </StatusPill>
            <span>
              {formatShop(e.createdAt, 'MMM D, YYYY h:mm A')}
              {e.user ? ` · ${e.user.name} (${roleLabel(e.user.role)})` : ' · System'}
            </span>
          </div>
          <div className="audit-history__summary">{e.summary}</div>
          {e.action === 'UPDATE' && e.details.length ? (
            <div className="audit-history__details">
              <AuditDetails details={e.details} />
            </div>
          ) : null}
        </div>
      ))}
      {items.length > FIRST ? (
        <Button type="link" size="small" onClick={() => setShowAll((v) => !v)} style={{ paddingInline: 0 }}>
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  );
}
