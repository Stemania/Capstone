import { formatShop } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { DatePicker, Empty, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import { type Dayjs } from 'dayjs';
import { workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { WorkerHistoryOperation, WorkerWorkHistory } from '../../types';

const { Text } = Typography;

type Props = { workerId: string };

export default function WorkerHistoryPanel({ workerId }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorkerWorkHistory | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [workerId, range]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: hist } = await workerProfileApi.getHistory(workerId, {
          from: range[0]?.format('YYYY-MM-DD'),
          to: range[1]?.format('YYYY-MM-DD'),
          page,
          perPage: 10,
        });
        if (!cancelled) setData(hist);
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workerId, range, page]);

  if (loading && !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!data) {
    return <Empty description="Could not load history" />;
  }

  const s = data.summary;
  const fmt = (v: number | null | undefined, suffix = '') =>
    v == null ? '—' : `${v}${suffix}`;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <DatePicker.RangePicker
          allowClear
          value={range}
          onChange={(vals) => setRange([vals?.[0] ?? null, vals?.[1] ?? null])}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <SummaryTile label="Completed ops" value={String(s.operationsCompleted)} />
        <SummaryTile
          label="Target vs actual"
          value={
            s.enoughHistory
              ? `${fmt(s.totalEstimatedHours)}h → ${fmt(s.totalActualHours)}h`
              : '—'
          }
        />
        <SummaryTile
          label="Avg vs target"
          value={s.enoughHistory ? fmt(s.averageVariancePct, '%') : '—'}
        />
        <SummaryTile
          label="Close to target"
          value={s.enoughHistory ? fmt(s.onEstimateRatePct, '%') : '—'}
        />
        <SummaryTile label="Rework" value={String(s.reworkCount)} />
      </div>
      {s.message ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 14, fontSize: 12 }}>
          {s.message}
        </Text>
      ) : null}

      <div style={{ fontWeight: 700, marginBottom: 8, color: '#0f1c2e' }}>Completed operations</div>
      <Table<WorkerHistoryOperation>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={data.operations.items}
        pagination={{
          current: data.operations.page,
          total: data.operations.total,
          pageSize: data.operations.perPage,
          onChange: (p) => setPage(p),
          showSizeChanger: false,
        }}
        locale={{ emptyText: 'No completed operations in this range' }}
        columns={[
          {
            title: 'Date',
            dataIndex: 'completedAt',
            width: 110,
            render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
          },
          { title: 'Job', dataIndex: 'jobNumber', width: 120, render: (v) => v || '—' },
          {
            title: 'Operation',
            key: 'op',
            render: (_: unknown, r) => (
              <span>
                {r.operationName}
                {r.isRework ? (
                  <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>
                    rework
                  </Text>
                ) : null}
                {r.isCrew ? (
                  <Tooltip title={(r.crew || []).map((m) => m.fullName).join(', ')}>
                    <Tag style={{ marginLeft: 6, fontSize: 11 }}>
                      Crew of {r.crewSize} · {r.crewRole === 'LEAD' ? 'lead' : 'helper'}
                    </Tag>
                  </Tooltip>
                ) : null}
              </span>
            ),
          },
          {
            title: 'Machine',
            dataIndex: 'machineUnitLabel',
            width: 110,
            render: (v) => v || '—',
          },
          {
            title: 'Target',
            dataIndex: 'estimatedHours',
            width: 72,
            align: 'right',
            render: (v: number | null) => (v == null ? '—' : v.toFixed(1)),
          },
          {
            title: 'Actual',
            dataIndex: 'actualHours',
            width: 72,
            align: 'right',
            render: (v: number | null) => (v == null ? '—' : v.toFixed(1)),
          },
          {
            title: 'Diff',
            dataIndex: 'differenceHours',
            width: 72,
            align: 'right',
            render: (v: number | null) => {
              if (v == null) return '—';
              const sign = v > 0 ? '+' : '';
              return `${sign}${v.toFixed(1)}`;
            },
          },
        ]}
      />

      <div style={{ fontWeight: 700, margin: '20px 0 8px', color: '#0f1c2e' }}>
        Tools currently held
      </div>
      {data.toolsHeld.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          None out with this worker
        </Text>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {data.toolsHeld.map((u) => (
            <li key={u.id} style={{ marginBottom: 4, fontSize: 13 }}>
              <strong>{u.toolTypeName || 'Tool'}</strong> · {u.assetCode}
              {u.heldSince ? ` · since ${formatShop(u.heldSince, 'MMM D')}` : ''}
            </li>
          ))}
        </ul>
      )}

      <div style={{ fontWeight: 700, margin: '20px 0 8px', color: '#0f1c2e' }}>
        Recent borrow / return
      </div>
      {data.toolEvents.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          No tool events yet
        </Text>
      ) : (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data.toolEvents}
          columns={[
            {
              title: 'When',
              dataIndex: 'createdAt',
              width: 140,
              render: (v: string) => formatShop(v, 'MMM D, h:mm A'),
            },
            {
              title: 'Event',
              dataIndex: 'type',
              width: 90,
              render: (t: string) => (t === 'RETURN' ? 'Returned' : 'Borrowed'),
            },
            {
              title: 'Unit',
              key: 'unit',
              render: (_: unknown, r: { toolName?: string; assetCode?: string | null }) =>
                [r.toolName, r.assetCode].filter(Boolean).join(' · ') || '—',
            },
          ]}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f1c2e', marginTop: 2 }}>{value}</div>
    </div>
  );
}
