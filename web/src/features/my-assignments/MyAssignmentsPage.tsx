import { useEffect, useState } from 'react';
import { Spin, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, type WorkerPalette } from '../../layouts/WorkerLayout';
import type { JobOrder } from '../../types';

function isOverdue(job: JobOrder) {
  return job.status !== 'COMPLETED' && dayjs(job.dueDate).isBefore(dayjs(), 'day');
}

function statusLabels(colors: WorkerPalette): Record<string, { text: string; color: string }> {
  return {
    ASSIGNED: { text: 'ASSIGNED', color: colors.accentSoft },
    IN_PROGRESS: { text: 'IN PROGRESS', color: colors.accent },
    COMPLETED: { text: 'DONE', color: colors.green },
    UNASSIGNED: { text: 'UNASSIGNED', color: colors.textSecondary },
  };
}

export default function MyAssignmentsPage() {
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { colors } = useWorkerTheme();

  useEffect(() => {
    jobOrdersApi
      .list()
      .then(({ data }) => setJobs(data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '64px auto' }} />;
  }

  const labels = statusLabels(colors);
  const activeCount = jobs.filter((j) => j.status !== 'COMPLETED').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 44, fontWeight: 800, color: colors.accent, lineHeight: 1 }}>
          {activeCount}
        </span>
        <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
          job{activeCount === 1 ? '' : 's'} on your
          <br />
          bench today
        </span>
      </div>
      <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 20 }}>
        Tap a job to open its operations.
      </p>

      {error && <p style={{ color: colors.red }}>{error}</p>}

      {jobs.length === 0 ? (
        <Empty description="No assignments yet" style={{ marginTop: 48 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map((job) => {
            const overdue = isOverdue(job);
            const status = labels[job.status];
            return (
              <div
                key={job.id}
                onClick={() => navigate(`/my-assignments/${job.id}`)}
                style={{
                  background: colors.card,
                  border: `1px solid ${colors.cardBorder}`,
                  borderTop: `3px solid ${overdue ? colors.red : status.color}`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1,
                      color: colors.textSecondary,
                      textTransform: 'uppercase',
                    }}
                  >
                    {job.clientName}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: overdue ? 'rgba(239,68,68,0.12)' : colors.chipBg,
                      color: overdue ? colors.red : status.color,
                    }}
                  >
                    {overdue ? 'OVERDUE' : status.text}
                  </span>
                </div>

                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{job.title}</div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: overdue ? colors.red : colors.textSecondary,
                      textAlign: 'right',
                    }}
                  >
                    Due {dayjs(job.dueDate).format('MMM D')}
                    {overdue && (
                      <>
                        {' · '}
                        <strong>running behind</strong>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
