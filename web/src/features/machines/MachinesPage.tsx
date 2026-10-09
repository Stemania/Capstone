import { formatShop, shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import {
  DatePicker,
  Input,
  Select,
  Modal,
  Form,
  Typography,
  Dropdown,
  Spin,
  message,
  Button,
  Checkbox,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SearchOutlined,
  MoreOutlined,
  WarningOutlined,
  UserOutlined,
  DownOutlined,
  RightOutlined,
  PlusOutlined,
  ClusterOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { usersApi } from '../../api/users.api';
import { PersonChip, crewNames } from '../../components/PersonAvatar';
import { personLabel } from '../../utils/people';
import { getErrorMessage } from '../../api/client';
import { DOWNTIME_REASONS } from '../../constants/downtimeReasons';
import type { MachineInfo, MachineUnitStatus, User } from '../../types';

type CardStatus = 'running' | 'idle' | 'breakdown' | 'retired';
type StatusFilter = CardStatus;

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

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
  if (unit.active === false) return 'retired';
  if (unit.down) return 'breakdown';
  if (unit.currentOperation) return 'running';
  return 'idle';
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  return formatShop(iso, 'MMM D, h:mm A');
}

function unitSearchText(unit: MachineUnitStatus): string {
  const cur = unit.currentOperation;
  const nxt = unit.nextOperation;
  return [
    unit.label,
    unit.machineTypeName,
    unit.machineTypeCode,
    unit.defaultOperatorName,
    unit.defaultOperatorNickname,
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
  if (status === 'retired') {
    return { text: 'Removed from shop floor' };
  }
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

function repairDateText(unit: MachineUnitStatus): string {
  const d = unit.openDowntime?.expectedRepairDate;
  return d ? `Expected repair ${formatShop(d, 'ddd D MMM')}` : 'No expected repair date';
}

const disablePastDates = (d: dayjs.Dayjs) => d.isBefore(shopToday(), 'day');

function cardNavigateTarget(unit: MachineUnitStatus): string | null {
  const op = unit.currentOperation ?? unit.nextOperation;
  return op?.jobOrderId ? `/job-orders/${op.jobOrderId}` : null;
}

function MachineUnitCard({
  unit,
  nowMs,
  onReport,
  onClose,
  onSetRepairDate,
  onOpenSchedule,
  onRetire,
  onRestore,
  onSetDefaultOperator,
  onClearDefaultOperator,
}: {
  unit: MachineUnitStatus;
  nowMs: number;
  onReport: (unit: MachineUnitStatus) => void;
  onClose: (unit: MachineUnitStatus) => void;
  onSetRepairDate: (unit: MachineUnitStatus) => void;
  onOpenSchedule: () => void;
  onRetire: (unit: MachineUnitStatus) => void;
  onRestore: (unit: MachineUnitStatus) => void;
  onSetDefaultOperator: (unit: MachineUnitStatus) => void;
  onClearDefaultOperator: (unit: MachineUnitStatus) => void;
}) {
  const navigate = useNavigate();
  const status = cardStatus(unit);
  const footer = cardFooter(unit, nowMs);
  const target = status === 'retired' ? null : cardNavigateTarget(unit);
  const cur = unit.currentOperation;
  const typeLabel = unit.machineTypeName || unit.machineTypeCode || 'Machine';
  const statusLabel =
    status === 'running'
      ? 'Running'
      : status === 'breakdown'
        ? 'Breakdown'
        : status === 'retired'
          ? 'Removed'
          : 'Idle';

  const menuItems: MenuProps['items'] = [];
  if (status === 'retired') {
    menuItems.push({
      key: 'restore',
      label: 'Restore machine',
      onClick: () => onRestore(unit),
    });
  } else {
    menuItems.push({
      key: 'defaultOp',
      label: unit.defaultOperatorId ? 'Change default operator' : 'Set default operator',
      onClick: () => onSetDefaultOperator(unit),
    });
    if (unit.defaultOperatorId) {
      menuItems.push({
        key: 'clearDefault',
        label: 'Clear default operator',
        onClick: () => onClearDefaultOperator(unit),
      });
    }
    menuItems.push({ type: 'divider' });
    if (!unit.down) {
      menuItems.push({
        key: 'report',
        label: 'Report breakdown',
        onClick: () => onReport(unit),
      });
    } else {
      menuItems.push({
        key: 'repairDate',
        label: unit.openDowntime?.expectedRepairDate
          ? 'Change expected repair date'
          : 'Set expected repair date',
        onClick: () => onSetRepairDate(unit),
      });
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
    menuItems.push({ type: 'divider' });
    menuItems.push({
      key: 'retire',
      label: 'Remove machine',
      danger: true,
      onClick: () => onRetire(unit),
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
      <header className="machine-card__banner">
        <div className="machine-card__banner-text">
          <div className="machine-card__label">{unit.label}</div>
          <div className="machine-card__type">{typeLabel}</div>
          <div className="machine-card__status-line">{statusLabel}</div>
        </div>
        <div className="machine-card__banner-deco" aria-hidden />
      </header>

      <div className="machine-card__body">
        <div className="machine-card__idle-copy" style={{ marginBottom: status === 'idle' ? 0 : 8 }}>
          {unit.defaultOperatorId ? (
            <PersonChip
              userId={unit.defaultOperatorId}
              fullName={unit.defaultOperatorName}
              nickname={unit.defaultOperatorNickname}
              photoVersion={unit.defaultOperatorPhotoVersion}
              size={28}
              strong
            />
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: '#e8ecf1',
                  color: '#5b6b7f',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TeamOutlined />
              </span>
              Open to all
            </span>
          )}
        </div>
        {status === 'retired' ? (
          <div className="machine-card__idle-copy">
            Taken off the floor — history kept. Restore or add a replacement if needed.
          </div>
        ) : status === 'running' && cur ? (
          <>
            <div className="machine-card__op">{cur.operationName}</div>
            {cur.jobNumber && <div className="machine-card__job">{cur.jobNumber}</div>}
            {cur.assignedWorkerName && (
              <div className="machine-card__worker">
                <UserOutlined />
                {crewNames(
                  cur.crew,
                  personLabel(cur.assignedWorkerName, cur.assignedWorkerNickname),
                )}
              </div>
            )}
          </>
        ) : status === 'breakdown' ? (
          <div className="machine-card__idle-copy">
            {unit.openDowntime?.reason || 'Machine reported down'}
            {unit.openDowntime?.reportedByName
              ? ` · ${unit.openDowntime.reportedByName}`
              : ''}
            <div>{repairDateText(unit)}</div>
          </div>
        ) : unit.nextOperation ? (
          <>
            <div className="machine-card__op">{unit.nextOperation.operationName}</div>
            {unit.nextOperation.jobNumber && (
              <div className="machine-card__job">{unit.nextOperation.jobNumber}</div>
            )}
          </>
        ) : status !== 'idle' ? null : (
          <div className="machine-card__idle-copy">Standing by — no work queued</div>
        )}
      </div>

      <footer
        className={[
          'machine-card__footer',
          footer.breakdown ? 'machine-card__footer--breakdown' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="machine-card__footer-text">{footer.text}</span>
        <div className="machine-card__footer-actions" onClick={(e) => e.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="topRight">
            <button type="button" className="machine-card__icon-btn" aria-label="Machine actions">
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
      </footer>
    </article>
  );
}

export default function MachinesPage() {
  const navigate = useNavigate();
  const [units, setUnits] = useState<MachineUnitStatus[]>([]);
  const [machineTypes, setMachineTypes] = useState<MachineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reportFor, setReportFor] = useState<MachineUnitStatus | null>(null);
  const [closeFor, setCloseFor] = useState<MachineUnitStatus | null>(null);
  const [repairFor, setRepairFor] = useState<MachineUnitStatus | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [operatorFor, setOperatorFor] = useState<MachineUnitStatus | null>(null);
  const [workers, setWorkers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [reportForm] = Form.useForm();
  const [closeForm] = Form.useForm();
  const [repairForm] = Form.useForm();
  const [addForm] = Form.useForm();
  const [operatorForm] = Form.useForm();

  const fetchUnits = async (includeRemoved = showRemoved) => {
    setLoading(true);
    try {
      const { data } = await operationsApi.machineUnitStatus(includeRemoved);
      setUnits(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, [showRemoved]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await jobOrdersApi.machines();
        setMachineTypes(data || []);
      } catch {
        /* add form can still open; types load best-effort */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await usersApi.list();
        setWorkers(
          data
            .filter(
              (u) =>
                (u.role === 'PRODUCTION_WORKER' || u.role === 'ADMIN') && u.status !== 'DISABLED'
            )
            .sort((a, b) => a.fullName.localeCompare(b.fullName))
        );
      } catch {
        /* operator picker best-effort */
      }
    })();
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
        values.note?.trim() || undefined,
        undefined,
        values.expectedRepairDate ? values.expectedRepairDate.format('YYYY-MM-DD') : null
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

  const submitRepairDate = async () => {
    if (!repairFor?.openDowntime) return;
    try {
      const values = await repairForm.validateFields();
      setSaving(true);
      await operationsApi.setExpectedRepairDate(
        repairFor.openDowntime.id,
        values.expectedRepairDate ? values.expectedRepairDate.format('YYYY-MM-DD') : null
      );
      message.success('Expected repair date saved');
      setRepairFor(null);
      repairForm.resetFields();
      await fetchUnits();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const retireUnit = (unit: MachineUnitStatus) => {
    Modal.confirm({
      title: `Remove ${unit.label}?`,
      icon: <WarningOutlined />,
      content:
        'Use this when the machine is scrapped or replaced. It leaves the shop floor but keeps history. For a temporary repair, use Report breakdown instead.',
      okText: 'Remove machine',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const { data } = await operationsApi.setMachineUnitActive(unit.id, false);
          message.success(`${unit.label} removed from shop floor`);
          await fetchUnits();
          const count = data.affectedCount || 0;
          if (count > 0) {
            Modal.confirm({
              title: `${count} operation${count === 1 ? '' : 's'} still point at this machine`,
              icon: <WarningOutlined />,
              content: 'Reschedule them onto a replacement unit from the schedule board.',
              okText: 'Open Schedule',
              cancelText: 'Stay here',
              onOk: () => navigate('/schedule'),
            });
          }
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
        }
      },
    });
  };

  const restoreUnit = async (unit: MachineUnitStatus) => {
    try {
      await operationsApi.setMachineUnitActive(unit.id, true);
      message.success(`${unit.label} restored`);
      await fetchUnits();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const submitAdd = async () => {
    try {
      const values = await addForm.validateFields();
      setSaving(true);
      const { data } = await operationsApi.createMachineUnit(
        values.machineTypeId,
        values.label?.trim() || undefined
      );
      message.success(`${data.label} added`);
      setAddOpen(false);
      addForm.resetFields();
      await fetchUnits();
      try {
        const { data: types } = await jobOrdersApi.machines();
        setMachineTypes(types || []);
      } catch {
        /* ignore */
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitDefaultOperator = async () => {
    if (!operatorFor) return;
    try {
      const values = await operatorForm.validateFields();
      setSaving(true);
      await operationsApi.setMachineUnitDefaultOperator(
        operatorFor.id,
        values.defaultOperatorId || null
      );
      message.success(`Default operator updated for ${operatorFor.label}`);
      setOperatorFor(null);
      operatorForm.resetFields();
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
        Shop floor status at a glance. Report a temporary breakdown, or add/remove units when
        machines are replaced.
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
              ...(showRemoved ? [{ value: 'retired' as const, label: 'Removed' }] : []),
            ]}
          />
          <Checkbox
            checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)}
            style={{ whiteSpace: 'nowrap' }}
          >
            Show removed
          </Checkbox>
        </div>
        <div className="std-list-actions">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              addForm.resetFields();
              setAddOpen(true);
            }}
            style={{ fontWeight: 700 }}
          >
            Add machine
          </Button>
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
                        onSetRepairDate={(u) => {
                          const d = u.openDowntime?.expectedRepairDate;
                          repairForm.setFieldsValue({ expectedRepairDate: d ? dayjs(d) : null });
                          setRepairFor(u);
                        }}
                        onOpenSchedule={() => navigate('/schedule')}
                        onRetire={retireUnit}
                        onRestore={restoreUnit}
                        onSetDefaultOperator={(u) => {
                          operatorForm.setFieldsValue({
                            defaultOperatorId: u.defaultOperatorId || undefined,
                          });
                          setOperatorFor(u);
                        }}
                        onClearDefaultOperator={async (u) => {
                          try {
                            setSaving(true);
                            await operationsApi.setMachineUnitDefaultOperator(u.id, null);
                            message.success(`Cleared default operator for ${u.label}`);
                            await fetchUnits();
                          } catch (err) {
                            message.error(getErrorMessage(err));
                          } finally {
                            setSaving(false);
                          }
                        }}
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
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        footer={null}
        width={560}
        centered
        destroyOnHidden
        className="app-form-modal"
        styles={{
          container: { padding: 0, borderRadius: 0, overflow: 'hidden' },
          body: { padding: 0 },
        }}
        closable={false}
      >
        <div className="app-form-modal__head">
          <div className="app-form-modal__icon">
            <ClusterOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">Add machine</div>
            <div className="app-form-modal__sub">
              Add a replacement or extra unit to the floor. Label is optional — we&apos;ll number it
              automatically (e.g. Milling #9).
            </div>
          </div>
          <button
            type="button"
            className="app-form-modal__close"
            onClick={() => setAddOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Form form={addForm} layout="vertical" style={{ padding: '20px 24px 8px' }}>
          {sectionLabel('Machine')}
          <Form.Item
            name="machineTypeId"
            label="Machine type"
            rules={[{ required: true, message: 'Choose a machine type' }]}
            style={{ marginBottom: 14 }}
          >
            <Select
              placeholder="Lathe, Milling, …"
              options={machineTypes
                .filter((t): t is MachineInfo & { id: string } => Boolean(t.id))
                .map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="label" label="Label (optional)" style={{ marginBottom: 14 }}>
            <Input placeholder="Leave blank for next number" maxLength={64} />
          </Form.Item>
        </Form>

        <div className="app-form-modal__footer">
          <Button onClick={() => setAddOpen(false)} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={saving}
            onClick={submitAdd}
            style={{ fontWeight: 700, minWidth: 120 }}
          >
            Add machine
          </Button>
        </div>
      </Modal>

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
              options={DOWNTIME_REASONS}
            />
          </Form.Item>
          <Form.Item
            name="note"
            label="Note"
            dependencies={['reason']}
            rules={[
              ({ getFieldValue }) => ({
                required: getFieldValue('reason') === 'OTHER',
                whitespace: true,
                message: 'Describe the breakdown when the reason is Other',
              }),
            ]}
          >
            <Input.TextArea rows={3} placeholder="Anything the shop should know" />
          </Form.Item>
          <Form.Item
            name="expectedRepairDate"
            label="Expected repair date (optional)"
            extra="Scheduling treats the machine as unavailable through this date. Leave empty if unknown."
          >
            <DatePicker
              style={{ width: '100%' }}
              format="ddd D MMM YYYY"
              disabledDate={disablePastDates}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={repairFor ? `Expected repair date — ${repairFor.label}` : 'Expected repair date'}
        open={!!repairFor}
        onCancel={() => setRepairFor(null)}
        onOk={submitRepairDate}
        confirmLoading={saving}
        okText="Save"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Scheduling treats the machine as unavailable through this date. Clear it if the repair
          date is no longer known.
        </Typography.Paragraph>
        <Form form={repairForm} layout="vertical">
          <Form.Item name="expectedRepairDate" label="Expected repair date">
            <DatePicker
              allowClear
              style={{ width: '100%' }}
              format="ddd D MMM YYYY"
              disabledDate={disablePastDates}
            />
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

      <Modal
        title={operatorFor ? `Default operator — ${operatorFor.label}` : 'Default operator'}
        open={!!operatorFor}
        onCancel={() => setOperatorFor(null)}
        onOk={submitDefaultOperator}
        confirmLoading={saving}
        okText="Save"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Usual operator for this unit (a worker or an Admin). Leave empty to keep it open to all.
          This only prefers the unit when scheduling — it does not block other workers.
        </Typography.Paragraph>
        <Form form={operatorForm} layout="vertical">
          <Form.Item name="defaultOperatorId" label="Operator">
            <Select
              allowClear
              showSearch
              optionFilterProp="search"
              placeholder="Open to all"
              options={workers.map((w) => ({
                value: w.id,
                search: personLabel(w.fullName, w.nickname),
                label: (
                  <PersonChip
                    userId={w.id}
                    fullName={w.fullName}
                    nickname={w.nickname}
                    photoVersion={w.photoVersion}
                  />
                ),
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
