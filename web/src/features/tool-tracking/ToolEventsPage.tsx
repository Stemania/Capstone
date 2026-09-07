import { useEffect, useState } from 'react';
import { Table } from 'antd';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import StatusPill from '../../components/StatusPill';
import type { ToolEvent, ToolEventType } from '../../types';

function eventLabel(t: ToolEventType) {
  switch (t) {
    case 'BORROW':
      return 'Borrowed';
    case 'RETURN':
      return 'Returned';
    case 'ISSUE':
      return 'Issued (legacy)';
    case 'ADJUST':
      return 'Adjusted';
    default:
      return t;
  }
}

function eventColor(t: ToolEventType): 'amber' | 'green' | 'gray' | 'blue' {
  switch (t) {
    case 'BORROW':
      return 'amber';
    case 'RETURN':
      return 'green';
    case 'ADJUST':
      return 'blue';
    default:
      return 'gray';
  }
}

type Props = {
  category: 'CONSUMABLE' | 'TOOL' | 'RETURNABLE_TOOL';
};

export default function ToolEventsPage({ category }: Props) {
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [category]);

  useEffect(() => {
    setLoading(true);
    toolsApi
      .listEvents({ page, perPage: 20, category })
      .then(({ data }) => {
        setEvents(data.items);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page, category]);

  const emptyText =
    category === 'CONSUMABLE'
      ? 'No consumable stock events yet. Adjustments appear here after activity.'
      : 'No borrow, return, or unit events yet.';

  return (
    <Table
      className="std-list-table"
      rowKey="id"
      size="small"
      columns={[
        {
          title: 'Date',
          dataIndex: 'createdAt',
          render: (d: string) => dayjs(d).format('MMM D, YYYY h:mm A'),
        },
        {
          title: 'Item',
          key: 'item',
          render: (_: unknown, r: ToolEvent) => (
            <div>
              <span style={{ fontWeight: 600 }}>{r.toolName}</span>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {r.assetCode || r.toolCode || '—'}
              </div>
            </div>
          ),
        },
        { title: 'Worker', dataIndex: 'workerName' },
        { title: 'Qty', dataIndex: 'quantity', align: 'right' as const, width: 72 },
        {
          title: 'Type',
          dataIndex: 'type',
          render: (t: ToolEventType) => (
            <StatusPill color={eventColor(t)}>{eventLabel(t)}</StatusPill>
          ),
        },
        {
          title: 'Reason',
          dataIndex: 'reason',
          render: (r: string | null | undefined) => r || '—',
        },
      ]}
      dataSource={events}
      loading={loading}
      pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
      scroll={{ x: true }}
      locale={{ emptyText }}
    />
  );
}
