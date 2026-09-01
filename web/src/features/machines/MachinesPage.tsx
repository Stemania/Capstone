import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Select,
  Modal,
  Form,
  Typography,
  Dropdown,
  Spin,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SearchOutlined,
  MoreOutlined,
  WarningOutlined,
  UserOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import { DOWNTIME_REASONS } from '../../constants/downtimeReasons';
import type { MachineUnitStatus } from '../../types';

type CardStatus = 'running' | 'idle' | 'breakdown';
type StatusFilter = CardStatus;

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

function cardStatus(unit: MachineUnitStatus): CardStatus {
  if (unit.down) return 'breakdown';
  if (unit.currentOperation) return 'running';
  return 'idle';
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  return dayjs(iso).format('MMM D, h:mm A');
}

function unitSearchText(unit: MachineUnitStatus): string {
  const cur = unit.currentOperation;
  const nxt = unit.nextOperation;
  return [
    unit.label,
    unit.machineTypeName,
    unit.machineTypeCode,
    unit.openDowntime?.reason,
    unit.openDowntime?.reportedByName,
    cur?.operationName,
    cur?.jobNumber,
    cur?.assignedWorkerName,
    nxt?.operationName,
    nxt?.jobNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function cardFooter(unit: MachineUnitStatus, nowMs: number): { text: string; breakdown?: boolean } {
  const status = cardStatus(unit);
  if (status === 'breakdown' && unit.openDowntime?.startedAt) {
    return {
      text: `Down ${formatOpenDuration(unit.openDowntime.startedAt, nowMs)}`,
      breakdown: true,
    };
  }
  if (status === 'running' && unit.currentOperation?.scheduledEnd) {
    return { text: `Expected finish ${formatWhen(unit.currentOperation.scheduledEnd)}` };
  }
  if (unit.nextOperation) {
    const op = unit.nextOperation;
    const when = op.scheduledStart ? formatWhen(op.scheduledStart) : 'Unscheduled';
    return { text: `Next: ${op.operationName}${op.jobNumber ? ` · ${op.jobNumber}` : ''} · ${when}` };
  }
  if (unit.affectedCount > 0) {
    return { text: `${unit.affectedCount} op${unit.affectedCount === 1 ? '' : 's'} pending schedule` };
  }
  return { text: 'No upcoming work' };
}

function cardNavigateTarget(unit: MachineUnitStatus): string | null {
  const op = unit.currentOperation ?? unit.nextOperation;
  return op?.jobOrderId ? `/job-orders/${op.jobOrderId}` : null;
}

function MachineUnitCard({
  unit,
  nowMs,
  onReport,
  onClose,
  onOpenSchedule,
}: {
  unit: MachineUnitStatus;
  nowMs: number;
  onReport: (unit: MachineUnitStatus) => void;
  onClose: (unit: MachineUnitStatus) => void;
  onOpenSchedule: () => void;
}) {
  const navigate = useNavigate();
  const status = cardStatus(unit);
  const footer = cardFooter(unit, nowMs);
  const target = cardNavigateTarget(unit);
  const cur = unit.currentOperation;

  const menuItems: MenuProps['items'] = [];
  if (!unit.down) {
    menuItems.push({
      key: 'report',
      label: 'Report breakdown',
      onClick: () => onReport(unit),
    });
  } else {
    menuItems.push({
      key: 'close',
      label: 'Close breakdown',
      onClick: () => onClose(unit),
    });
  }
  if (unit.affectedCount > 0) {
    menuItems.push({
      key: 'schedule',
      label: 'Open schedule',
      onClick: onOpenSchedule,
    });
  }

  return (
    <article
      className={[
        'machine-card',
        `machine-card--${status}`,
        target ? 'machine-card--clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (target) navigate(target);
      }}
      onKeyDown={(e) => {
        if (target && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          navigate(target);
        }
      }}
      role={target ? 'button' : undefined}
      tabIndex={target ? 0 : undefined}
    >
      <div className="machine-card__head">
        <div className="machine-card__label">{unit.label}</div>
        <div className="machine-card__menu" onClick={(e) => e.stopPropagation()}>
          <StatusPill
            color={status === 'running' ? 'green' : status === 'breakdown' ? 'red' : 'gray'}
            compact
          >
            {status === 'running' ? 'Running' : status === 'breakdown' ? 'Breakdown' : 'Idle'}
          </StatusPill>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined style={{ fontSize: 16 }} />}
              aria-label="Machine actions"
              style={{ marginLeft: 2 }}
            />
          </Dropdown>
        </div>
      </div>

      <div className="machine-card__body">
        {status === 'running' && cur ? (
          <>
            <div className="machine-card__op">{cur.operationName}</div>
            {cur.jobNumber && <div className="machine-card__job">{cur.jobNumber}</div>}
            {cur.assignedWorkerName && (
              <div className="machine-card__worker">
                <UserOutlined style={{ fontSize: 12, color: '#64748b' }} />
                {cur.assignedWorkerName}
              </div>
            )}
          </>
        ) : status === 'breakdown' ? (
          <div className="machine-card__idle-copy">
            {unit.openDowntime?.reason || 'Machine reported down'}
          </div>
        ) : unit.nextOperation ? (
          <>
            <div className="machine-card__op">{unit.nextOperation.operationName}</div>
            {unit.nextOperation.jobNumber && (
              <div className="machine-card__job">{unit.nextOperation.jobNumber}</div>
            )}
          </>
        ) : (
          <div className="machine-card__idle-copy">Standing by</div>
        )}
      </div>

      <div
        className={[
          'machine-card__footer',
          footer.breakdown ? 'machine-card__footer--breakdown' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {footer.text}
      </div>
    </article>
  );
}

export default function MachinesPage() {
  const navigate = useNavigate();
  const [units, setUnits] = useState<MachineUnitStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>([]);
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
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
      if (q && !unitSearchText(u).includes(q)) return false;
      if (statusFilter.length && !statusFilter.includes(cardStatus(u))) return false;
      return true;
    });
  }, [units, search, statusFilter]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { typeId: string; typeName: string; units: MachineUnitStatus[] }
    >();
    for (const unit of filtered) {
      const typeId = unit.machineTypeId || unit.machineTypeCode || 'other';
      const typeName = unit.machineTypeName || unit.machineTypeCode || 'Other';
      const existing = map.get(typeId);
      if (existing) {
        existing.units.push(unit);
      } else {
        map.set(typeId, { typeId, typeName, units: [unit] });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.typeName.localeCompare(b.typeName));
  }, [filtered]);

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

  const toggleType = (typeId: string) => {
    setCollapsedTypes((prev) => ({ ...prev, [typeId]: !prev[typeId] }));
  };

  return (
    <div className="std-list-page">
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Shop floor status at a glance. Report a breakdown to block the unit on the schedule.
      </Typography.Text>

      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Search machine, job, worker…"
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
              { value: 'running', label: 'Running' },
              { value: 'idle', label: 'Idle' },
              { value: 'breakdown', label: 'Breakdown' },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="page-spinner">
          <Spin size="large" />
        </div>
      ) : groups.length === 0 ? (
        <div className="machines-board__empty">No machines match your filters yet</div>
      ) : (
        <div className="machines-board__groups">
          {groups.map((group) => {
            const collapsed = collapsedTypes[group.typeId] ?? false;
            return (
              <section key={group.typeId}>
                <button
                  type="button"
                  className="machines-board__section-header"
                  onClick={() => toggleType(group.typeId)}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? (
                    <RightOutlined className="machines-board__section-chevron" />
                  ) : (
                    <DownOutlined className="machines-board__section-chevron" />
                  )}
                  <span className="machines-board__section-title">
                    {group.typeName} · {group.units.length} unit
                    {group.units.length === 1 ? '' : 's'}
                  </span>
                </button>
                {!collapsed && (
                  <div className="machines-board__grid">
                    {group.units.map((unit) => (
                      <MachineUnitCard
                        key={unit.id}
                        unit={unit}
                        nowMs={nowMs}
                        onReport={(u) => {
                          reportForm.resetFields();
                          setReportFor(u);
                        }}
                        onClose={(u) => {
                          closeForm.resetFields();
                          setCloseFor(u);
                        }}
                        onOpenSchedule={() => navigate('/schedule')}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
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
