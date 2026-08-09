import { useEffect, useMemo, useState } from 'react';
import { Spin, Empty, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { Operation } from '../../types';

function priorityMeta(priority?: string): { label: string; color: string } {
  const p = priority || 'MODERATE';
  if (p === 'HIGH') return { label: 'High', color: '#dc2626' };
  if (p === 'LOW') return { label: 'Low', color: '#16a34a' };
  return { label: 'Moderate', color: '#d97706' };
}

function opStatusBadge(
  op: Operation,
  colors: { red: string; accent: string; green: string; greenSoft: string }
) {
  const overdue =
    op.status !== 'COMPLETED' && op.dueDate && dayjs(op.dueDate).isBefore(dayjs(), 'day');
  if (overdue) {
    return { text: 'Overdue', bg: 'rgba(220,38,38,0.12)', color: colors.red };
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
    return { text: 'Rework', bg: 'rgba(217,119,6,0.12)', color: '#d97706' };
  }
  return { text: 'Pending', bg: 'rgba(37,99,235,0.12)', color: colors.accent };
}

export default function MyAssignmentsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { colors } = useWorkerTheme();

  useEffect(() => {
    operationsApi
      .mine()
      .then(({ data }) => setOperations(data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

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
        subtitle="Operations assigned to you"
      />

      <div style={{ padding: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            background: colors.chipBg,
            borderRadius: 12,
            padding: 4,
            marginBottom: 14,
            border: `1px solid ${colors.cardBorder}`,
          }}
        >
          {(
            [
              { key: 'active' as const, label: `Active (${active.length})` },
              { key: 'completed' as const, label: `Completed (${completed.length})` },
            ]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: 'none',
                borderRadius: 10,
                padding: '10px 8px',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                background: tab === t.key ? colors.card : 'transparent',
                color: tab === t.key ? colors.text : colors.textSecondary,
                boxShadow: tab === t.key ? colors.shadow : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder="Search operations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginBottom: 16,
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
            description={query ? 'No matching operations' : 'No operations in this list'}
            style={{ marginTop: 40 }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((op) => {
              const badge = opStatusBadge(op, colors);
              const pri = priorityMeta(op.jobPriority);
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
                        {op.dueDate ? dayjs(op.dueDate).format('MMM D') : '—'}
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
                        Est. Hours
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {op.estimatedHours != null ? op.estimatedHours : '—'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: colors.textSecondary,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: pri.color,
                      }}
                    />
                    {pri.label} priority
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
