import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Input, Select, Modal, Form, Typography, Dropdown, Spin, message } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { SearchOutlined, MoreOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import { useIsPhone } from '../../hooks/useIsPhone';
import { DOWNTIME_REASONS } from '../../constants/downtimeReasons';
import type { MachineUnitStatus } from '../../types';

type StatusFilter = 'down' | 'available';

function formatOpenDuration(startedAt: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - dayjs(startedAt).valueOf());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function MachinesPage() {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [units, setUnits] = useState<MachineUnitStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reportFor, setReportFor] = useState<MachineUnitStatus | null>(null);
  const [closeFor, setCloseFor] = useState<MachineUnitStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportForm] = Form.useForm();
  const [closeForm] = Form.useForm();

  const fetchUnits = async () => {
    setLoading(true);
    try {
      const { data } = await operationsApi.machineUnitStatus();
      setUnits(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  useEffect(() => {
    if (!units.some((u) => u.down)) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [units]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (
        q &&
        !`${u.label} ${u.machineTypeName || ''} ${u.machineTypeCode || ''} ${u.openDowntime?.reason || ''} ${u.openDowntime?.reportedByName || ''}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (statusFilter.length) {
        const key: StatusFilter = u.down ? 'down' : 'available';
        if (!statusFilter.includes(key)) return false;
      }
      return true;
    });
  }, [units, search, statusFilter]);

  const warnScheduled = (count: number) => {
    if (!count) return;
    Modal.confirm({
      title: `${count} operation${count === 1 ? '' : 's'} still scheduled`,
      icon: <WarningOutlined />,
      content:
        'They were not moved. This machine is now marked down and unavailable for new scheduling. Open the schedule to reschedule them.',
      okText: 'Open Schedule',
      cancelText: 'Stay here',
      onOk: () => navigate('/schedule'),
    });
  };

  const submitReport = async () => {
    if (!reportFor) return;
    try {
      const values = await reportForm.validateFields();
      setSaving(true);
      const { data } = await operationsApi.openDowntime(
        reportFor.id,
        values.reason,
        values.note?.trim() || undefined
      );
      message.success('Breakdown reported');
      setReportFor(null);
      reportForm.resetFields();
      await fetchUnits();
      warnScheduled(data.affectedCount || 0);
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitClose = async () => {
    if (!closeFor?.openDowntime) return;
    try {
      const values = await closeForm.validateFields();
      setSaving(true);
      await operationsApi.closeDowntime(
        closeFor.openDowntime.id,
        values.note?.trim() || undefined
      );
      message.success('Breakdown closed');
      setCloseFor(null);
      closeForm.resetFields();
      await fetchUnits();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<MachineUnitStatus> = [
    {
      title: 'Machine',
      dataIndex: 'label',
      key: 'label',
      sorter: (a, b) => a.label.localeCompare(b.label),
      render: (v: string) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{v}</span>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'machineTypeName',
      key: 'type',
      width: 140,
      sorter: (a, b) => (a.machineTypeName || '').localeCompare(b.machineTypeName || ''),
      render: (v: string | null | undefined) => (
        <span style={{ fontSize: 13 }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: unknown, record) =>
        record.down ? (
          <StatusPill color="red" compact>
            Down
          </StatusPill>
        ) : (
          <StatusPill color="green" compact>
            Available
          </StatusPill>
        ),
    },
    {
      title: 'Duration',
      key: 'duration',
      width: 100,
      render: (_: unknown, record) =>
        record.down && record.openDowntime?.startedAt ? (
          <span style={{ fontWeight: 700, fontSize: 13, color: '#dc2626' }}>
            {formatOpenDuration(record.openDowntime.startedAt, nowMs)}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
    {
      title: 'Reason',
      key: 'reason',
      ellipsis: true,
      render: (_: unknown, record) => (
        <span style={{ fontSize: 13 }}>{record.openDowntime?.reason || '—'}</span>
      ),
    },
    {
      title: 'Reported by',
      key: 'reportedBy',
      width: 160,
      ellipsis: true,
      render: (_: unknown, record) => (
        <span style={{ fontSize: 13 }}>{record.openDowntime?.reportedByName || '—'}</span>
      ),
    },
    {
      title: 'Since',
      key: 'since',
      width: 150,
      render: (_: unknown, record) =>
        record.openDowntime?.startedAt ? (
          <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {dayjs(record.openDowntime.startedAt).format('MMM D, h:mm A')}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
    {
      title: 'Scheduled',
      key: 'affected',
      width: 110,
      sorter: (a, b) => a.affectedCount - b.affectedCount,
      render: (_: unknown, record) =>
        record.affectedCount > 0 ? (
          <Button type="link" size="small" style={{ padding: 0, fontWeight: 700 }} onClick={() => navigate('/schedule')}>
            {record.affectedCount} op{record.affectedCount === 1 ? '' : 's'}
          </Button>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      align: 'center',
      render: (_: unknown, record) => {
        const items: MenuProps['items'] = [];
        if (!record.down) {
          items.push({
            key: 'report',
            label: 'Report breakdown',
            onClick: () => {
              reportForm.resetFields();
              setReportFor(record);
            },
          });
        } else {
          items.push({
            key: 'close',
            label: 'Close breakdown',
            onClick: () => {
              closeForm.resetFields();
              setCloseFor(record);
            },
          });
        }
        if (record.affectedCount > 0) {
          items.push({
            key: 'schedule',
            label: 'Open schedule',
            onClick: () => navigate('/schedule'),
          });
        }
        return (
          <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
            <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div className="std-list-page">
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Shop machines. Report a breakdown to block the unit on the schedule. Existing jobs on that
        machine stay put until you reschedule them.
      </Typography.Text>

      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Search machine, type, reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="std-list-search"
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Status"
            className="std-list-filter std-list-filter--sm"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'down', label: 'Down' },
              { value: 'available', label: 'Available' },
            ]}
          />
        </div>
      </div>

      {isPhone ? (
        <div className="admin-cards">
          {loading && (
            <div className="page-spinner">
              <Spin />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="admin-cards__empty">No machines match your filters yet</div>
          )}
          {!loading &&
            filtered.map((record) => {
              const items: MenuProps['items'] = [];
              if (!record.down) {
                items.push({
                  key: 'report',
                  label: 'Report breakdown',
                  onClick: () => {
                    reportForm.resetFields();
                    setReportFor(record);
                  },
                });
              } else {
                items.push({
                  key: 'close',
                  label: 'Close breakdown',
                  onClick: () => {
                    closeForm.resetFields();
                    setCloseFor(record);
                  },
                });
              }
              if (record.affectedCount > 0) {
                items.push({
                  key: 'schedule',
                  label: 'Open schedule',
                  onClick: () => navigate('/schedule'),
                });
              }
              return (
                <div key={record.id} className="admin-card">
                  <div className="admin-card__top">
                    <div>
                      <div className="admin-card__title">{record.label}</div>
                      <div className="admin-card__meta">
                        {record.machineTypeName || 'Machine'}
                        {record.down && record.openDowntime?.reason ? ` · ${record.openDowntime.reason}` : ''}
                      </div>
                    </div>
                    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
                      <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
                    </Dropdown>
                  </div>
                  <div className="admin-card__row">
                    {record.down ? (
                      <StatusPill color="red" compact>
                        Down {record.openDowntime?.startedAt ? `· ${formatOpenDuration(record.openDowntime.startedAt, nowMs)}` : ''}
                      </StatusPill>
                    ) : (
                      <StatusPill color="green" compact>
                        Available
                      </StatusPill>
                    )}
                    {record.affectedCount > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>
                        {record.affectedCount} scheduled op{record.affectedCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
      <Table
        className="std-list-table"
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        showSorterTooltip={false}
        tableLayout="fixed"
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (total) => `${total} machine${total === 1 ? '' : 's'}`,
        }}
        locale={{ emptyText: 'No machines match your filters yet' }}
      />
      )}

      <Modal
        title={reportFor ? `Report breakdown — ${reportFor.label}` : 'Report breakdown'}
        open={!!reportFor}
        onCancel={() => setReportFor(null)}
        onOk={submitReport}
        confirmLoading={saving}
        okText="Report"
        destroyOnHidden
      >
        <Form form={reportForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, message: 'Pick a reason' }]}
          >
            <Select
              placeholder="Why is it down?"
              options={DOWNTIME_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </Form.Item>
          <Form.Item name="note" label="Note (optional)">
            <Input.TextArea rows={3} placeholder="Anything the shop should know" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={closeFor ? `Close breakdown — ${closeFor.label}` : 'Close breakdown'}
        open={!!closeFor}
        onCancel={() => setCloseFor(null)}
        onOk={submitClose}
        confirmLoading={saving}
        okText="Close breakdown"
        destroyOnHidden
      >
        {closeFor?.openDowntime && (
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            {closeFor.openDowntime.reason}
            {closeFor.openDowntime.startedAt
              ? ` · down ${formatOpenDuration(closeFor.openDowntime.startedAt, nowMs)}`
              : ''}
            {closeFor.openDowntime.reportedByName
              ? ` · reported by ${closeFor.openDowntime.reportedByName}`
              : ''}
          </div>
        )}
        <Form form={closeForm} layout="vertical">
          <Form.Item name="note" label="Resolution note (optional)">
            <Input.TextArea rows={3} placeholder="What fixed it, parts used…" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
