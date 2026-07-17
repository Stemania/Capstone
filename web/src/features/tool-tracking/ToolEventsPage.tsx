import { useEffect, useState } from 'react';
import { Table } from 'antd';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import StatusPill from '../../components/StatusPill';
import type { ToolEvent } from '../../types';

export default function ToolEventsPage() {
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    toolsApi
      .listEvents({ page, perPage: 20 })
      .then(({ data }) => {
        setEvents(data.items);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page]);

  const columns = [
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => dayjs(d).format('MMM D, YYYY h:mm A'),
    },
    {
      title: 'Tool',
      dataIndex: 'toolName',
      key: 'toolName',
      render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span>,
    },
    {
      title: 'Code',
      dataIndex: 'toolCode',
      key: 'toolCode',
      render: (c: string) => <span style={{ color: '#64748b', fontSize: 12 }}>{c}</span>,
    },
    { title: 'Worker', dataIndex: 'workerName', key: 'workerName' },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => (
        <StatusPill color={t === 'BORROW' ? 'amber' : 'green'}>
          {t === 'BORROW' ? 'Borrowed' : 'Returned'}
        </StatusPill>
      ),
    },
  ];

  return (
    <div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={events}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        scroll={{ x: true }}
      />
    </div>
  );
}
