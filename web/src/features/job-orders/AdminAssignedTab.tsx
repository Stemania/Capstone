import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, Segmented, Space, Table, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { useNavigate } from 'react-router-dom';
import { formatShop } from '../../utils/shopTime';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { StatusPill, EmptyState, PageSkeleton, EllipsisText, IdChip, rowOpenProps } from '../../components/ui';
import { canStartOperation, showActionError } from '../my-assignments/operationActions';
import { machineLabel, opStatusPill, opTitle } from '../my-assignments/opStatus';
import type { Operation, OperationPauseReason } from '../../types';

const PAUSE_REASONS: { value: OperationPauseReason; label: string }[] = [
  { value: 'END_OF_SHIFT', label: 'End of shift' },
  { value: 'BREAK', label: 'Break' },
  { value: 'MACHINE_DOWN', label: 'Machine down' },
  { value: 'WAITING_MATERIAL', label: 'Waiting for material' },
  { value: 'WAITING_PRIOR_OPERATION', label: 'Waiting on prior operation' },
  { value: 'OTHER', label: 'Other' },
];

function AdminAssignedTable({ onCount }: { onCount?: (n: number) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subFilter, setSubFilter] = useState<'active' | 'completed'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pauseFor, setPauseFor] = useState<Operation | null>(null);
  const [pauseReason, setPauseReason] = useState<OperationPauseReason>('BREAK');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    operationsApi
      .mine()
      .then(({ data }) => {
        setOperations(data);
        onCount?.(data.filter((o) => o.status !== 'COMPLETED').length);
      })
      .catch((err) => {
        setOperations([]);
        setError(getErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [onCount]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = operations.filter((o) => o.status !== 'COMPLETED');
  const completed = operations.filter((o) => o.status === 'COMPLETED');
  const rows = subFilter === 'active' ? active : completed;

  const run = async (op: Operation, kind: 'start' | 'resume' | 'complete' | 'pause') => {
    setBusyId(op.id);
    try {
      if (kind === 'pause') {
        await operationsApi.pause(op.id, pauseReason);
        message.success('Paused');
        setPauseFor(null);
      } else if (kind === 'start') {
        await operationsApi.start(op.id);
        message.success('Started');
      } else if (kind === 'resume') {
        await operationsApi.resume(op.id);
        message.success('Resumed');
      } else {
        await operationsApi.complete(op.id);
        message.success('Marked complete');
      }
      reload();
    } catch (err) {
      showActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const columns: TableColumnsType<Operation> = useMemo(
    () => [
      {
        title: 'Job #',
        key: 'job',
        width: 110,
        render: (_, op) => (
          <IdChip>{op.jobNumber || op.jobOrderId.slice(0, 8).toUpperCase()}</IdChip>
        ),
      },
      {
        title: 'Operation',
        key: 'op',
        ellipsis: true,
        render: (_, op) => <EllipsisText>{opTitle(op)}</EllipsisText>,
      },
      {
        title: 'Client',
        key: 'client',
        ellipsis: true,
        render: (_, op) => <EllipsisText>{op.clientName || '—'}</EllipsisText>,
      },
      {
        title: 'Machine',
        key: 'machine',
        ellipsis: true,
        render: (_, op) => <EllipsisText>{machineLabel(op) || '—'}</EllipsisText>,
      },
      {
        title: 'Due',
        key: 'due',
        width: 110,
        render: (_, op) => (op.dueDate ? formatShop(op.dueDate, 'MMM D, YYYY') : '—'),
      },
      {
        title: 'Target hours',
        key: 'hours',
        width: 110,
        align: 'right',
        className: 'tabular-nums',
        render: (_, op) => (op.estimatedHours != null ? op.estimatedHours : '—'),
      },
      {
        title: 'Status',
        key: 'status',
        width: 120,
        render: (_, op) => {
          const pill = opStatusPill(op);
          return (
            <StatusPill tone={pill.tone} compact>
              {pill.label}
            </StatusPill>
          );
        },
      },
      {
        title: '',
        key: 'act',
        width: 240,
        fixed: 'right',
        render: (_, op) => {
          if (op.status === 'COMPLETED') {
            return (
              <Button type="link" size="small" onClick={() => navigate(`/my-assignments/${op.jobOrderId}`)}>
                Open
              </Button>
            );
          }
          const busy = busyId === op.id;
          const mineOps = operations.filter((o) => o.jobOrderId === op.jobOrderId);
          const startable = canStartOperation(op, mineOps, user?.id);
          const running = op.status === 'IN_PROGRESS' && !op.isPaused;
          const paused = op.status === 'IN_PROGRESS' && op.isPaused;
          return (
            <Space size={4} wrap>
              {startable && (
                <Button type="primary" size="small" loading={busy} onClick={() => void run(op, 'start')}>
                  Start
                </Button>
              )}
              {paused && (
                <Button size="small" loading={busy} onClick={() => void run(op, 'resume')}>
                  Resume
                </Button>
              )}
              {running && (
                <Button
                  size="small"
                  loading={busy}
                  onClick={() => {
                    setPauseReason('BREAK');
                    setPauseFor(op);
                  }}
                >
                  Pause
                </Button>
              )}
              {(running || paused) && (
                <Button size="small" loading={busy} onClick={() => void run(op, 'complete')}>
                  Complete
                </Button>
              )}
              <Button type="link" size="small" onClick={() => navigate(`/my-assignments/${op.jobOrderId}`)}>
                Open
              </Button>
            </Space>
          );
        },
      },
    ],
    [busyId, navigate, operations, user?.id]
  );

  if (loading) return <PageSkeleton variant="list" />;
  if (error) return <div style={{ color: 'var(--tone-red-fg)', padding: 16 }}>{error}</div>;

  return (
    <div className="admin-assigned-tab">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={subFilter}
          onChange={(v) => setSubFilter(v as 'active' | 'completed')}
          options={[
            { label: `Active (${active.length})`, value: 'active' },
            { label: `Completed (${completed.length})`, value: 'completed' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          compact
          title={subFilter === 'completed' ? 'No finished operations yet' : 'No active operations'}
          description={subFilter === 'active' ? 'Operations assigned to you show up here.' : undefined}
        />
      ) : (
        <Table
          className="std-list-table jo-list-table"
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 960 }}
          onRow={(op) => rowOpenProps(() => navigate(`/my-assignments/${op.jobOrderId}`))}
        />
      )}

      <Modal
        open={!!pauseFor}
        title={pauseFor ? `Pause ${opTitle(pauseFor)}` : 'Pause'}
        okText="Pause"
        confirmLoading={busyId === pauseFor?.id}
        onCancel={() => setPauseFor(null)}
        onOk={() => pauseFor && void run(pauseFor, 'pause')}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8 }}>Reason</div>
        <Select
          style={{ width: '100%' }}
          value={pauseReason}
          onChange={setPauseReason}
          options={PAUSE_REASONS}
        />
      </Modal>
    </div>
  );
}

/** Admin "Assigned" tab — desktop table of operations assigned to the logged-in Admin. */
export default function AdminAssignedTab({ onCount }: { onCount?: (n: number) => void }) {
  return <AdminAssignedTable onCount={onCount} />;
}

export function fetchAssignedActiveCount(): Promise<number> {
  return operationsApi
    .mine()
    .then(({ data }) => data.filter((o) => o.status !== 'COMPLETED').length)
    .catch(() => 0);
}
