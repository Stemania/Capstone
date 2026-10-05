import { formatShop } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { Button, Spin, Table, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ClientDetail } from '../../types';
import StatusPill, { type PillColor } from '../../components/StatusPill';

const { Title, Text } = Typography;

const STATUS_PILL: Record<string, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Pending', color: 'gray' },
  SCHEDULED: { label: 'Scheduled', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'blue' },
  COMPLETED: { label: 'Completed', color: 'green' },
  DELIVERED: { label: 'Delivered', color: 'green' },
};

function money(v: number | null | undefined) {
  if (v == null) return '—';
  return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await clientsApi.get(id);
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <Text type="secondary">Client not found.</Text>
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => navigate('/clients')}>Back to clients</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/clients')}
        style={{ marginBottom: 12, paddingLeft: 0 }}
      >
        Clients
      </Button>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0, color: '#0f1c2e' }}>
          {data.name}
        </Title>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginTop: 14,
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Contact</div>
            <div>{data.contact || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Email</div>
            <div>{data.email || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Mobile</div>
            <div>{data.mobileNumber || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Notify</div>
            <div>
              {[data.notifyByEmail ? 'Email' : null, data.notifyBySms ? 'SMS' : null]
                .filter(Boolean)
                .join(' · ') || 'Off'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, fontSize: 14 }}>
          <div>
            <span style={{ color: '#64748b' }}>Jobs </span>
            <strong>{data.totals.jobCount}</strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Total value (excl. pending) </span>
            <strong>{money(data.totals.totalValue)}</strong>
          </div>
        </div>
      </div>

      <Title level={5} style={{ color: '#0f1c2e' }}>
        Job orders
      </Title>
      <Table
        className="std-list-table"
        rowKey="id"
        size="small"
        pagination={{ pageSize: 20 }}
        dataSource={data.jobs}
        locale={{ emptyText: 'No job orders for this client yet.' }}
        onRow={(r) => ({
          onClick: () => navigate(`/job-orders/${r.id}`),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: 'Job #', dataIndex: 'jobNumber', width: 130 },
          { title: 'Title', dataIndex: 'title' },
          {
            title: 'Date',
            dataIndex: 'createdAt',
            width: 120,
            render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
          },
          {
            title: 'Value',
            dataIndex: 'amount',
            width: 110,
            align: 'right',
            render: (v: number | null) => money(v),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 120,
            render: (s: string) => {
              const pill = STATUS_PILL[s] || { label: s, color: 'gray' as PillColor };
              return (
                <StatusPill color={pill.color} compact>
                  {pill.label}
                </StatusPill>
              );
            },
          },
          {
            title: 'On time',
            dataIndex: 'deliveredOnTime',
            width: 100,
            render: (v: boolean | null) => {
              if (v === true) return <Tag color="green">Yes</Tag>;
              if (v === false) return <Tag color="#7A1528">Late</Tag>;
              return <Text type="secondary">—</Text>;
            },
          },
        ]}
      />
    </div>
  );
}
