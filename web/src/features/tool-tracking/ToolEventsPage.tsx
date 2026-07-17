import { useEffect, useState } from 'react';
import { Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import type { ToolEvent } from '../../types';

const { Title } = Typography;

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
    { title: 'Tool', dataIndex: 'toolName', key: 'toolName' },
    { title: 'Code', dataIndex: 'toolCode', key: 'toolCode' },
    { title: 'Worker', dataIndex: 'workerName', key: 'workerName' },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => (
        <Tag color={t === 'BORROW' ? 'orange' : 'green'}>{t}</Tag>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>Tool Borrow/Return Logs</Title>
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
