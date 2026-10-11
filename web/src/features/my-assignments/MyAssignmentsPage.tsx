import { formatShop } from '../../utils/shopTime';
import { useMemo, useState } from 'react';
import { Input, Segmented } from 'antd';
import { ProfileOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import SyncChip from '../../offline/SyncChip';
import { CrewChips } from '../../components/PersonAvatar';
import { EmptyState, PageSkeleton, StatusPill } from '../../components/ui';
import { isOverdue, machineLabel, opStatusPill, opTitle } from './opStatus';
import { useMyOperations } from './useMyOperations';

export default function MyAssignmentsPage() {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { operations, loading, error } = useMyOperations();

  const active = operations.filter((o) => o.status !== 'COMPLETED');
  const completed = operations.filter((o) => o.status === 'COMPLETED');
  const source = tab === 'active' ? active : completed;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((o) =>
      [o.operationName, o.name, o.jobTitle, o.clientName, o.jobNumber, o.machineTypeName, o.machineUnitLabel].some(
        (v) => (v || '').toLowerCase().includes(q)
      )
    );
  }, [source, query]);

  return (
    <div>
      <WorkerPageHeader
        title="Assigned jobs"
        subtitle={loading ? undefined : `${active.length} active · ${completed.length} completed`}
      />

      <div className="w-page">
        <div className="w-toolbar">
          <Segmented
            block
            className="worker-seg"
            value={tab}
            onChange={(v) => setTab(v as 'active' | 'completed')}
            options={[
              { label: `Active (${active.length})`, value: 'active' },
              { label: `Completed (${completed.length})`, value: 'completed' },
            ]}
          />
          <Input
            allowClear
            className="worker-search"
            prefix={<SearchOutlined style={{ color: 'var(--c-text-muted)' }} />}
            placeholder="Search JO, operation, client, machine"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <PageSkeleton variant="cards" />
        ) : error ? (
          <div className="w-card" style={{ color: 'var(--tone-red-fg)', fontSize: 14 }}>
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            icon={query ? <SearchOutlined /> : <ProfileOutlined />}
            title={
              query
                ? 'No matching jobs'
                : tab === 'completed'
                  ? 'No finished operations yet'
                  : 'No active operations'
            }
            description={!query && tab === 'active' ? 'New assignments show up here.' : undefined}
          />
        ) : (
          filtered.map((op) => {
            const pill = opStatusPill(op);
            const machine = machineLabel(op);
            return (
              <button
                key={op.id}
                type="button"
                className="w-card w-card--flush w-job"
                onClick={() => navigate(`/my-assignments/${op.jobOrderId}`)}
              >
                <div className="w-job__top">
                  <span>{op.jobNumber || op.jobOrderId.slice(0, 8).toUpperCase()}</span>
                  <span className="w-job__pills">
                    {op.syncState && <SyncChip state={op.syncState} />}
                    <StatusPill tone={pill.tone} compact>
                      {pill.label}
                    </StatusPill>
                  </span>
                </div>
                <div className="w-job__name">{opTitle(op)}</div>
                {(op.clientName || op.jobTitle) && (
                  <div className="w-job__client">{op.clientName || op.jobTitle}</div>
                )}
                <div className="w-job__meta">
                  <span>
                    Machine <b>{machine || '—'}</b>
                  </span>
                  <span>
                    Due{' '}
                    <b className={isOverdue(op) ? 'is-late' : undefined}>
                      {op.dueDate ? formatShop(op.dueDate, 'MMM D') : '—'}
                    </b>
                  </span>
                  <span>
                    Target <b>{op.estimatedHours != null ? `${op.estimatedHours} h` : '—'}</b>
                    {op.actualWorkedHours != null ? ` · worked ${op.actualWorkedHours} h` : ''}
                  </span>
                </div>
                {(op.crew?.length || 0) > 1 ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12 }}>
                    <span className="w-muted">Crew</span>
                    <CrewChips crew={op.crew} size={18} />
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
