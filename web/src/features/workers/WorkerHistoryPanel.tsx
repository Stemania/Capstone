import { formatShop } from '../../utils/shopTime';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DatePicker, Pagination, Skeleton, Tag, Tooltip, Typography, message } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { EmptyState } from '../../components/ui';
import { type Dayjs } from 'dayjs';
import { workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { WorkerHistoryOperation, WorkerWorkHistory } from '../../types';
import ResponsiveTable from '../../components/ui/ResponsiveTable';
import { HISTORY_PAGE_SIZE, historyRangeLabel } from './workerHistoryPaging';

const { Text } = Typography;

type Props = { workerId: string };

export default function WorkerHistoryPanel({ workerId }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorkerWorkHistory | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [heldPage, setHeldPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: hist } = await workerProfileApi.getHistory(workerId, {
          from: range[0]?.format('YYYY-MM-DD'),
          to: range[1]?.format('YYYY-MM-DD'),
          page,
          perPage: HISTORY_PAGE_SIZE,
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
    return <Skeleton active paragraph={{ rows: 6 }} title={false} />;
  }

  if (!data) {
    return (
      <EmptyState
        compact
        icon={<WarningOutlined />}
        title="Could not load history"
        description="Pick the worker again to retry."
      />
    );
  }

  const s = data.summary;
  const fmt = (v: number | null | undefined, suffix = '') =>
    v == null ? '—' : `${v}${suffix}`;
  const compare =
    s.enoughHistory
      ? `${fmt(s.totalEstimatedHours)}h → ${fmt(s.totalActualHours)}h`
      : '—';

  return (
    <div className="wh-history">
      <div style={{ marginBottom: 14 }}>
        <DatePicker.RangePicker
          allowClear
          value={range}
          onChange={(vals) => {
            setRange([vals?.[0] ?? null, vals?.[1] ?? null]);
            setPage(1);
          }}
        />
      </div>

      <div className="wh-summary">
        <SummaryTile label="Completed ops" value={String(s.operationsCompleted)} />
        <SummaryTile label="Target vs actual" value={compare} compare />
        <SummaryTile label="Avg vs target" value={s.enoughHistory ? fmt(s.averageVariancePct, '%') : '—'} />
        <SummaryTile label="Close to target" value={s.enoughHistory ? fmt(s.onEstimateRatePct, '%') : '—'} />
        <SummaryTile label="Rework" value={String(s.reworkCount)} />
      </div>
      {s.message ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 14, fontSize: 12 }}>
          {s.message}
        </Text>
      ) : null}

      <div className="wh-section-title">Completed operations</div>
      <ResponsiveTable<WorkerHistoryOperation>
        className="wh-ops"
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={data.operations.items}
        card={{ title: 'jobNumber', subtitle: ['completedAt'] }}
        onRow={(record) => ({
          onClick: () => {
            if (record.jobOrderId) navigate(`/job-orders/${record.jobOrderId}`);
          },
        })}
        pagination={{
          current: data.operations.page,
          total: data.operations.total,
          pageSize: HISTORY_PAGE_SIZE,
          size: 'small',
          onChange: (p) => setPage(p),
          showSizeChanger: false,
          showTotal: (total, span) =>
            historyRangeLabel(total, span[0] > 0 ? Math.floor((span[0] - 1) / HISTORY_PAGE_SIZE) + 1 : 1),
        }}
        locale={{ emptyText: 'No completed operations in this range' }}
        columns={[
          {
            title: 'Date',
            dataIndex: 'completedAt',
            width: 118,
            render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
          },
          {
            title: 'Job',
            dataIndex: 'jobNumber',
            width: 128,
            onCell: () => ({ className: 'wh-job-cell' }),
            onHeaderCell: () => ({ className: 'wh-job-cell' }),
            render: (v: string | null, r) =>
              r.jobOrderId ? (
                <Link
                  to={`/job-orders/${r.jobOrderId}`}
                  className="wh-jobno"
                  onClick={(e) => e.stopPropagation()}
                >
                  {v || '—'}
                </Link>
              ) : (
                <span className="wh-jobno">{v || '—'}</span>
              ),
          },
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

      <div className="wh-tools">
        <ToolPanel
          title="Currently held"
          empty="No tools held"
          items={data.toolsHeld}
          page={heldPage}
          onPage={setHeldPage}
          renderItem={(u) => (
            <li key={u.id} className="wh-tool-row">
              <strong>{u.toolTypeName || 'Tool'}</strong>
              <span className="wh-tool-row__meta">
                {u.assetCode}
                {u.heldSince ? ` · since ${formatShop(u.heldSince, 'MMM D')}` : ''}
              </span>
            </li>
          )}
        />
        <ToolPanel
          title="Recent borrow & return"
          empty="No borrow history"
          items={data.toolEvents}
          page={eventPage}
          onPage={setEventPage}
          renderItem={(ev) => (
            <li key={ev.id} className="wh-tool-row">
              <strong>{ev.type === 'RETURN' ? 'Returned' : 'Borrowed'}</strong>
              <span className="wh-tool-row__meta">
                {[ev.toolName, ev.assetCode].filter(Boolean).join(' · ') || '—'}
                {ev.createdAt ? ` · ${formatShop(ev.createdAt, 'MMM D, h:mm A')}` : ''}
              </span>
            </li>
          )}
        />
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  compare = false,
}: {
  label: string;
  value: string;
  compare?: boolean;
}) {
  return (
    <div className={`wh-tile${compare ? ' wh-tile--compare' : ''}`}>
      <div className="wh-tile__label">{label}</div>
      <div className="wh-tile__value">{value}</div>
    </div>
  );
}

function ToolPanel<T extends { id: string }>({
  title,
  empty,
  items,
  page,
  onPage,
  renderItem,
}: {
  title: string;
  empty: string;
  items: T[];
  page: number;
  onPage: (page: number) => void;
  renderItem: (item: T) => ReactNode;
}) {
  const start = (page - 1) * HISTORY_PAGE_SIZE;
  const slice = items.slice(start, start + HISTORY_PAGE_SIZE);
  return (
    <section className="wh-tool-panel">
      <div className="wh-tool-panel__title">{title}</div>
      {items.length === 0 ? (
        <div className="wh-tool-panel__body wh-tool-panel__empty">{empty}</div>
      ) : (
        <ul className="wh-tool-panel__body">{slice.map(renderItem)}</ul>
      )}
      {items.length > 0 ? (
        <Pagination
          className="wh-pager"
          size="small"
          current={page}
          pageSize={HISTORY_PAGE_SIZE}
          total={items.length}
          showSizeChanger={false}
          showTotal={(total, span) =>
            historyRangeLabel(total, span[0] > 0 ? Math.floor((span[0] - 1) / HISTORY_PAGE_SIZE) + 1 : 1)
          }
          onChange={onPage}
        />
      ) : (
        <div className="wh-pager" aria-hidden />
      )}
    </section>
  );
}
