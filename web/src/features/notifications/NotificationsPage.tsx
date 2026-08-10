import { useEffect, useState } from 'react';
import { Table, Select, Button, Typography, Space, message, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { clientsApi } from '../../api/jobOrders.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type { Client, NotificationLog, NotificationStatus } from '../../types';

const statusStyle: Record<NotificationStatus, { label: string; color: PillColor }> = {
  PENDING: { label: 'Pending', color: 'amber' },
  SENT: { label: 'Sent', color: 'green' },
  FAILED: { label: 'Failed', color: 'red' },
  SKIPPED: { label: 'Skipped', color: 'gray' },
};

export default function NotificationsPage() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  const [jobOrderId, setJobOrderId] = useState<string | undefined>();
  const [resending, setResending] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await notificationsApi.list({
        status,
        clientId,
        jobOrderId: jobOrderId || undefined,
      });
      setLogs(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clientsApi.list().then(({ data }) => setClients(data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [status, clientId, jobOrderId]);

  const onResend = async (id: string) => {
    setResending(id);
    try {
      await notificationsApi.resend(id);
      message.success('Resent');
      fetchLogs();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setResending(null);
    }
  };

  const columns = [
    {
      title: 'When',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (v?: string) => (v ? dayjs(v).format('MMM D, YYYY HH:mm') : '—'),
    },
    {
      title: 'Job',
      key: 'job',
      width: 180,
      render: (_: unknown, r: NotificationLog) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#64748b' }}>{r.jobNumber || '—'}</div>
          <div style={{ fontSize: 13 }}>{r.jobTitle || r.jobOrderId.slice(0, 8)}</div>
        </div>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 140,
      ellipsis: true,
    },
    {
      title: 'Milestone',
      dataIndex: 'milestone',
      key: 'milestone',
      width: 130,
      render: (m: string) => <Tag>{m.replace(/_/g, ' ')}</Tag>,
    },
    {
      title: 'Channel',
      dataIndex: 'channel',
      key: 'channel',
      width: 80,
    },
    {
      title: 'To',
      dataIndex: 'recipient',
      key: 'recipient',
      width: 160,
      ellipsis: true,
    },
    {
      title: 'Message',
      dataIndex: 'messageBody',
      key: 'messageBody',
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: NotificationStatus, r: NotificationLog) => {
        const st = statusStyle[s];
        return (
          <div>
            <StatusPill color={st.color} compact>
              {st.label}
            </StatusPill>
            {r.errorMessage && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }} title={r.errorMessage}>
                {r.errorMessage.length > 48 ? `${r.errorMessage.slice(0, 48)}…` : r.errorMessage}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, r: NotificationLog) =>
        r.status === 'FAILED' ? (
          <Button
            size="small"
            loading={resending === r.id}
            onClick={() => onResend(r.id)}
          >
            Resend
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Typography.Text type="secondary">
          Milestone notifications sent to clients (received, started, completed, delivered).
        </Typography.Text>
        <Space wrap>
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 130 }}
            value={status}
            onChange={setStatus}
            options={['PENDING', 'SENT', 'FAILED', 'SKIPPED'].map((s) => ({ value: s, label: s }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Client"
            style={{ width: 180 }}
            value={clientId}
            onChange={setClientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
          <InputJobFilter value={jobOrderId} onChange={setJobOrderId} />
          <Button icon={<ReloadOutlined />} onClick={fetchLogs}>
            Refresh
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={logs}
        columns={columns}
        pagination={{ pageSize: 25 }}
        size="middle"
        scroll={{ x: 1100 }}
      />
    </div>
  );
}

function InputJobFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => {
    setDraft(value || '');
  }, [value]);
  return (
    <input
      value={draft}
      placeholder="Job order ID"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft.trim() || undefined)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onChange(draft.trim() || undefined);
      }}
      style={{
        height: 32,
        padding: '4px 11px',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        width: 200,
      }}
    />
  );
}
