import { formatShop } from '../../utils/shopTime';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Spin, Table, Typography, message } from 'antd';
import {
  ArrowLeftOutlined,
  BellOutlined,
  MailOutlined,
  PhoneOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ClientDetail } from '../../types';
import StatusPill, { type PillColor } from '../../components/StatusPill';

const { Text } = Typography;

const NAVY = '#0f1c2e';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

const STATUS_PILL: Record<string, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Pending', color: 'gray' },
  SCHEDULED: { label: 'Scheduled', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'teal' },
  COMPLETED: { label: 'Completed', color: 'green' },
  DELIVERED: { label: 'Delivered', color: 'green' },
};

const CARD_STYLE = {
  background: '#fff',
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
} as const;

function money(v: number | null | undefined) {
  if (v == null) return '—';
  return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

function ContactItem({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: '#f1f5f9',
          color: MUTED,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: NAVY,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div style={{ ...CARD_STYLE, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.3, marginTop: 4 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
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

  const stats = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const active = jobs.filter((j) => j.status === 'SCHEDULED' || j.status === 'IN_PROGRESS').length;
    const delivered = jobs.filter((j) => j.status === 'DELIVERED');
    const judged = delivered.filter((j) => j.deliveredOnTime != null);
    const onTime = judged.filter((j) => j.deliveredOnTime).length;
    return {
      active,
      delivered: delivered.length,
      onTimePct: judged.length ? Math.round((onTime / judged.length) * 100) : null,
      onTime,
      judged: judged.length,
    };
  }, [data]);

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

  const notify =
    [data.notifyByEmail ? 'Email' : null, data.notifyBySms ? 'SMS' : null].filter(Boolean).join(' · ') ||
    'Off';

  return (
    <div>
      <Button
        color="primary"
        variant="outlined"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/clients')}
        style={{ marginBottom: 12, borderRadius: 8 }}
      >
        Exit
      </Button>

      <div style={{ ...CARD_STYLE, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: NAVY,
              color: '#fff',
              fontSize: 18,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {initials(data.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>{data.name}</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
              {data.createdAt ? `Client since ${formatShop(data.createdAt, 'MMMM YYYY')}` : 'Client'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginTop: 18,
            paddingTop: 18,
            borderTop: `1px solid #f1f5f9`,
          }}
        >
          <ContactItem icon={<UserOutlined />} label="Contact person">
            {data.contact || '—'}
          </ContactItem>
          <ContactItem icon={<MailOutlined />} label="Email">
            {data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : '—'}
          </ContactItem>
          <ContactItem icon={<PhoneOutlined />} label="Mobile">
            {data.mobileNumber ? <a href={`tel:${data.mobileNumber}`}>{data.mobileNumber}</a> : '—'}
          </ContactItem>
          <ContactItem icon={<BellOutlined />} label="Notifications">
            {notify}
          </ContactItem>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatTile label="Job orders" value={data.totals.jobCount} hint="All time, including pending" />
        <StatTile label="Active" value={stats.active} hint="Scheduled or in progress" />
        <StatTile label="Delivered" value={stats.delivered} />
        <StatTile
          label="On-time delivery"
          value={stats.onTimePct == null ? '—' : `${stats.onTimePct}%`}
          hint={stats.judged ? `${stats.onTime} of ${stats.judged} delivered on time` : 'No deliveries yet'}
        />
        <StatTile label="Total value" value={money(data.totals.totalValue)} hint="Excludes pending jobs" />
      </div>

      <div style={{ ...CARD_STYLE, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Job orders</div>
          <div style={{ fontSize: 12, color: MUTED }}>
            {data.jobs.length} job{data.jobs.length === 1 ? '' : 's'}
          </div>
        </div>
        <Table
          className="std-list-table"
          rowKey="id"
          size="middle"
          scroll={{ x: 760 }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={data.jobs}
          locale={{ emptyText: 'No job orders for this client yet.' }}
          onRow={(r) => ({
            onClick: () => navigate(`/job-orders/${r.id}`),
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: 'Job #',
              dataIndex: 'jobNumber',
              width: 140,
              render: (v: string | null) => (
                <span style={{ fontWeight: 600, color: NAVY }}>{v || '—'}</span>
              ),
            },
            { title: 'Title', dataIndex: 'title', ellipsis: true },
            {
              title: 'Created',
              dataIndex: 'createdAt',
              width: 120,
              render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
            },
            {
              title: 'Date required',
              dataIndex: 'dueDate',
              width: 130,
              render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
            },
            {
              title: 'Value',
              dataIndex: 'amount',
              width: 110,
              align: 'right',
              render: (v: number | null) => <span style={{ fontWeight: 600 }}>{money(v)}</span>,
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
                if (v === true) return <StatusPill color="green" compact>On time</StatusPill>;
                if (v === false) return <StatusPill color="red" compact>Late</StatusPill>;
                return <Text type="secondary">—</Text>;
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
