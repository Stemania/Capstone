import { useEffect, useMemo, useState } from 'react';
import { Spin, Empty, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { JobOrder } from '../../types';

function urgency(job: JobOrder): { label: string; color: string } | null {
  if (job.status === 'COMPLETED') return null;
  const days = dayjs(job.dueDate).diff(dayjs(), 'day');
  if (days < 0) return { label: 'High', color: '#dc2626' };
  if (days <= 2) return { label: 'High', color: '#d97706' };
  if (days <= 7) return { label: 'Medium', color: '#d97706' };
  return { label: 'Low', color: '#16a34a' };
}

export default function MyAssignmentsPage() {
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { colors } = useWorkerTheme();

  useEffect(() => {
    jobOrdersApi
      .list()
      .then(({ data }) => setJobs(data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const assigned = jobs.filter((j) => j.status !== 'COMPLETED');
  const completed = jobs.filter((j) => j.status === 'COMPLETED');
  const source = tab === 'active' ? assigned : completed;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        (j.clientName || '').toLowerCase().includes(q) ||
        (j.jobNumber || '').toLowerCase().includes(q)
    );
  }, [source, query]);

  const statusBadge = (job: JobOrder) => {
    if (job.status !== 'COMPLETED' && dayjs(job.dueDate).isBefore(dayjs(), 'day')) {
      return { text: 'Overdue', bg: 'rgba(220,38,38,0.12)', color: colors.red };
    }
    if (job.status === 'IN_PROGRESS') {
      return { text: 'In Progress', bg: colors.greenSoft, color: colors.green };
    }
    if (job.status === 'COMPLETED') {
      return { text: 'Completed', bg: colors.greenSoft, color: colors.green };
    }
    return { text: 'Assigned', bg: 'rgba(37,99,235,0.12)', color: colors.accent };
  };

  return (
    <div>
      <WorkerPageHeader
        title="My Jobs"
        subtitle="Your assigned production work"
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
              { key: 'active' as const, label: `Assigned (${assigned.length})` },
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
          placeholder="Search job orders..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginBottom: 16,
            background: colors.inputBg,
            borderColor: colors.cardBorder,
          }}
        />

        {loading ? (
          <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
        ) : error ? (
          <p style={{ color: colors.red }}>{error}</p>
        ) : filtered.length === 0 ? (
          <Empty description={query ? 'No matching jobs' : 'No jobs in this list'} style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((job) => {
              const badge = statusBadge(job);
              const pri = urgency(job);
              const total = job.opsTotal || 0;
              const done = job.opsCompleted || 0;
              const pct = total ? Math.round((done / total) * 100) : 0;

              return (
                <div
                  key={job.id}
                  onClick={() => navigate(`/my-assignments/${job.id}`)}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 16,
                    cursor: 'pointer',
                    boxShadow: colors.shadow,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600 }}>
                      {job.jobNumber || job.id.slice(0, 8).toUpperCase()}
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

                  <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>{job.title}</div>
                  <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14 }}>
                    {job.clientName}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1.2fr',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>Due Date</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{dayjs(job.dueDate).format('MMM D')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>Progress</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {done} / {total} ops
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>Next Operation</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {job.nextOperation || '—'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: colors.chipBg,
                      overflow: 'hidden',
                      marginBottom: pri ? 10 : 0,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: colors.accent,
                        borderRadius: 999,
                      }}
                    />
                  </div>

                  {pri && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.textSecondary }}>
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
