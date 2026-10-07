import { formatShop, shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Spin, Empty, Input, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { analyticsApi } from '../../api/analytics.api';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import axios from 'axios';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import { useOffline } from '../../offline/OfflineProvider';
import { offlineCache } from '../../offline/offlineCache';
import { overlayOperations, type OverlaidOperation } from '../../offline/overlay';
import SyncChip from '../../offline/SyncChip';
import type { MyWorkSummary, Operation } from '../../types';

function opStatusBadge(
  op: OverlaidOperation,
  colors: { red: string; accent: string; green: string; greenSoft: string }
) {
  if (op.waitingForMaterials && op.status !== 'COMPLETED' && op.status !== 'IN_PROGRESS') {
    return { text: 'Waiting for materials', bg: 'rgba(217,119,6,0.12)', color: '#d97706' };
  }
  const overdue =
    op.status !== 'COMPLETED' && op.dueDate && dayjs(op.dueDate).isBefore(shopToday(), 'day');
  if (overdue) {
    return { text: 'Overdue', bg: 'rgba(122,21,40,0.12)', color: colors.red };
  }
  if (op.status === 'IN_PROGRESS') {
    return { text: 'In Progress', bg: 'rgba(37,99,235,0.12)', color: colors.accent };
  }
  if (op.status === 'COMPLETED') {
    return { text: 'Completed', bg: colors.greenSoft, color: colors.green };
  }
  if (op.status === 'SCHEDULED') {
    return { text: 'Scheduled', bg: 'rgba(37,99,235,0.12)', color: colors.accent };
  }
  if (op.status === 'REWORK') {
    return { text: 'Redo', bg: 'rgba(217,119,6,0.12)', color: '#d97706' };
  }
  return { text: 'Pending', bg: 'rgba(37,99,235,0.12)', color: colors.accent };
}

function MyWorkSummaryCard() {
  const { colors } = useWorkerTheme();
  const [summary, setSummary] = useState<MyWorkSummary | null>(null);
  const [period, setPeriod] = useState<'thisWeek' | 'thisMonth'>('thisWeek');

  useEffect(() => {
    analyticsApi
      .mySummary()
      .then(({ data }) => setSummary(data))
      .catch(() => setSummary(null));
  }, []);

  if (!summary) return null;
  const f = summary[period];
  const stats = [
    {
      label: 'Finished operations',
      value: String(f.finishedOperations),
      hint: f.redoOperations ? `${f.redoOperations} redo` : undefined,
    },
    { label: 'Hours worked', value: f.hoursWorked == null ? '—' : `${f.hoursWorked.toFixed(1)}h` },
    {
      label: 'Labor efficiency',
      value: f.laborEfficiencyPct == null ? '—' : `${Math.round(f.laborEfficiencyPct)}%`,
      hint: f.targetHours ? `${f.targetHours.toFixed(1)}h target` : 'No target times yet',
    },
  ];

  return (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
        boxShadow: colors.shadow,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700, color: colors.text }}>My work</div>
        <Segmented
          size="small"
          value={period}
          onChange={(v) => setPeriod(v as 'thisWeek' | 'thisMonth')}
          options={[
            { label: 'This week', value: 'thisWeek' },
            { label: 'This month', value: 'thisMonth' },
          ]}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: colors.chipBg, borderRadius: 10, padding: '10px 8px' }}>
            <div style={{ fontSize: 11, color: colors.textSecondary }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text, lineHeight: 1.3 }}>{s.value}</div>
            {s.hint ? <div style={{ fontSize: 11, color: colors.textSecondary }}>{s.hint}</div> : null}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 8 }}>
        Your own finished operations only. Labor efficiency is target hours divided by hours worked
        on operations that had a target; over 100% means faster than planned.
      </div>
    </div>
  );
}

export default function MyAssignmentsPage() {
  const [loaded, setLoaded] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { colors } = useWorkerTheme();
  const { online, userId, pending, version } = useOffline();

  useEffect(() => {
    if (!userId) return;
    const fromPhone = () => offlineCache.read(userId).mine;
    if (!online) {
      const saved = fromPhone();
      if (saved) setLoaded(saved);
      else setError('No assignments saved on this phone yet. Connect once to download them.');
      setLoading(false);
      return;
    }
    operationsApi
      .mine()
      .then(({ data }) => {
        offlineCache.saveMine(userId, data);
        setLoaded(data);
        setError('');
      })
      .catch((err) => {
        const saved = axios.isAxiosError(err) && !err.response ? fromPhone() : null;
        if (saved) setLoaded(saved);
        else setError(getErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [online, userId, version]);

  const operations = useMemo(() => overlayOperations(loaded, pending), [loaded, pending]);

  const active = operations.filter((o) => o.status !== 'COMPLETED');
  const completed = operations.filter((o) => o.status === 'COMPLETED');
  const source = tab === 'active' ? active : completed;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (o) =>
        (o.operationName || o.name || '').toLowerCase().includes(q) ||
        (o.jobTitle || '').toLowerCase().includes(q) ||
        (o.clientName || '').toLowerCase().includes(q) ||
        (o.jobNumber || '').toLowerCase().includes(q) ||
        (o.machineTypeName || '').toLowerCase().includes(q)
    );
  }, [source, query]);

  return (
    <div>
      <WorkerPageHeader
        title="My Assignments"
        subtitle="Your jobs"
      />

      <div style={{ padding: 16 }}>
        {online && <MyWorkSummaryCard />}
        <Segmented
          block
          className="worker-seg"
          value={tab}
          onChange={(v) => setTab(v as 'active' | 'completed')}
          options={[
            { label: `Active (${active.length})`, value: 'active' },
            { label: `Completed (${completed.length})`, value: 'completed' },
          ]}
          style={{ marginBottom: 12 }}
        />

        <Input
          allowClear
          className="worker-search"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder="Search operations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginBottom: 14,
            background: colors.inputBg,
            borderColor: colors.cardBorder,
          }}
        />

        {loading ? (
          <div className="page-spinner">
            <Spin size="large" />
          </div>
        ) : error ? (
          <p style={{ color: colors.red }}>{error}</p>
        ) : filtered.length === 0 ? (
          <Empty
            description={
              query
                ? 'No matching assignments'
                : tab === 'completed'
                  ? 'No finished assignments yet'
                  : 'No active assignments yet'
            }
            style={{ marginTop: 40 }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((op) => {
              const badge = opStatusBadge(op, colors);
              const name = op.operationName || op.name || 'Operation';

              return (
                <div
                  key={op.id}
                  onClick={() => navigate(`/my-assignments/${op.jobOrderId}`)}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 16,
                    cursor: 'pointer',
                    boxShadow: colors.shadow,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600 }}>
                      {op.jobNumber || op.jobOrderId.slice(0, 8).toUpperCase()}
                      {op.sequenceNo != null ? ` · Op ${op.sequenceNo}` : ''}
                    </span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {op.syncState && <SyncChip state={op.syncState} />}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: badge.bg,
                          color: badge.color,
                        }}
                      >
                        {badge.text}
                      </span>
                    </span>
                  </div>

                  <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>{name}</div>
                  <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14 }}>
                    {op.jobTitle}
                    {op.clientName ? ` · ${op.clientName}` : ''}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1.2fr',
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>
                        Due Date
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {op.dueDate ? formatShop(op.dueDate, 'MMM D') : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>
                        Machine
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {op.machineTypeName ||
                          (op.machineNames && op.machineNames[0]) ||
                          '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>
                        Target hours
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {op.estimatedHours != null ? op.estimatedHours : '—'}
                        {op.actualWorkedHours != null
                          ? ` · worked ${op.actualWorkedHours}`
                          : ''}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
