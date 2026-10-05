import { formatShop, shopToday } from '../../utils/shopTime';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Table,
  Tooltip,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PrinterOutlined,
  ScissorOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import OverdueTag from '../../components/OverdueTag';
import StatusPill from '../../components/StatusPill';
import type { MaterialPurchase, SupplierOrder } from '../../types';
import OrderMaterialsModal from './OrderMaterialsModal';
import { LINE_STATUS_PILL, ORDER_STATUS_PILL, fmtDay, fmtMoney, fmtQty } from './supplierOrderUi';

function askDate(title: string, intro: string, okText: string, onOk: (d: string) => Promise<void>) {
  let picked: Dayjs = shopToday();
  Modal.confirm({
    title,
    content: (
      <div style={{ marginTop: 8 }}>
        <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>{intro}</div>
        <DatePicker
          style={{ width: '100%' }}
          defaultValue={shopToday()}
          format="YYYY-MM-DD"
          allowClear={false}
          onChange={(d) => {
            if (d) picked = d;
          }}
        />
      </div>
    ),
    okText,
    onOk: () => onOk(picked.format('YYYY-MM-DD')),
  });
}

export default function SupplierOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOfficeStaff } = useAuth();
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toReceive, setToReceive] = useState<string[]>([]);
  const [editLine, setEditLine] = useState<MaterialPurchase | null>(null);
  const [editValues, setEditValues] = useState<{
    quantity: number | null;
    unitCost: number | null;
    gradeOrSpec: string;
  }>({ quantity: null, unitCost: null, gradeOrSpec: '' });
  const [notes, setNotes] = useState('');
  const [vatRate, setVatRate] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [newDate, setNewDate] = useState<Dayjs | null>(null);
  const [dateNote, setDateNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await supplierOrdersApi.get(id);
      setOrder(data);
      setNotes(data.notes || '');
      setVatRate(data.vatRate ?? null);
      setToReceive([]);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<{ data: SupplierOrder }>, ok: string) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setOrder((prev) => ({
        ...data,
        expectedDeliveryChanges: data.expectedDeliveryChanges ?? prev?.expectedDeliveryChanges,
      }));
      setNotes(data.notes || '');
      setVatRate(data.vatRate ?? null);
      setToReceive([]);
      message.success(ok);
    } catch (err) {
      message.error(getErrorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!order) return <div style={{ padding: 24 }}>Supplier order not found.</div>;

  const isDraft = order.status === 'DRAFT';
  const receivable = order.status === 'ISSUED' || order.status === 'PARTIALLY_RECEIVED';
  const lines = order.lines || [];
  const pill = ORDER_STATUS_PILL[order.status];
  const editableDraft = isDraft && isOfficeStaff;
  const receivableByMe = receivable && isOfficeStaff;
  const draftDirty =
    editableDraft && ((order.notes || '') !== notes || (order.vatRate ?? null) !== vatRate);

  const issue = () =>
    askDate(
      `Issue ${order.supplierName} order?`,
      `This assigns the PO number, sets the expected delivery date from the supplier's ${
        order.supplierLeadTimeDays ?? '—'
      }-day lead time, and locks the lines. Date issued:`,
      'Issue order',
      (d) => run(() => supplierOrdersApi.issue(order.id, d), 'Order issued')
    );

  const openDateChange = () => {
    setNewDate(order.expectedDeliveryDate ? dayjs(order.expectedDeliveryDate) : null);
    setDateNote('');
    setDateOpen(true);
  };

  const saveDateChange = async () => {
    if (!newDate || !dateNote.trim()) return;
    setBusy(true);
    try {
      const { data } = await supplierOrdersApi.changeExpectedDelivery(
        order.id,
        newDate.format('YYYY-MM-DD'),
        dateNote.trim()
      );
      setOrder(data);
      setDateOpen(false);
      const moved = data.movedJobs || [];
      const stuck = data.notMovedJobs || [];
      message.success(
        moved.length
          ? `Expected delivery updated. Moved later: ${moved.map((j) => j.jobNumber).join(', ')}`
          : 'Expected delivery updated. No job needed to move.'
      );
      if (stuck.length) {
        message.warning(
          `No free slot found for ${stuck.map((j) => j.jobNumber).join(', ')}; their schedule was left as it is.`
        );
      }
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const receiveSelected = () =>
    askDate(
      `Receive ${toReceive.length} line${toReceive.length === 1 ? '' : 's'}?`,
      'Date received',
      'Receive',
      (d) => run(() => supplierOrdersApi.receive(order.id, toReceive, d), 'Lines received')
    );

  const cancelOrder = () =>
    Modal.confirm({
      title: 'Cancel this supplier order?',
      content: 'Every line is cancelled and its material goes back to "to order".',
      okText: 'Cancel order',
      okButtonProps: { danger: true },
      cancelText: 'Keep',
      onOk: () => run(() => supplierOrdersApi.cancel(order.id), 'Order cancelled'),
    });

  const cancelLine = (ln: MaterialPurchase) =>
    Modal.confirm({
      title: `Cancel “${ln.materialName}” for ${ln.jobNumber}?`,
      content: 'The line stays on the order as cancelled; the material goes back to "to order".',
      okText: 'Cancel line',
      okButtonProps: { danger: true },
      cancelText: 'Keep',
      onOk: () => run(() => supplierOrdersApi.cancelLine(order.id, ln.id), 'Line cancelled'),
    });

  const splitLine = (ln: MaterialPurchase) => {
    let keep: number | null = null;
    Modal.confirm({
      title: `Split “${ln.materialName}” (${fmtQty(ln.quantity, ln.unit)})`,
      content: (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>
            Quantity that arrived (kept on this line). The rest moves to a new line to receive
            later.
          </div>
          <InputNumber
            min={0.0001}
            max={ln.quantity}
            style={{ width: '100%' }}
            addonAfter={ln.unit}
            onChange={(v) => {
              keep = v;
            }}
          />
        </div>
      ),
      okText: 'Split',
      onOk: () => {
        if (!keep || keep >= ln.quantity) {
          message.error(`Enter a quantity below ${ln.quantity}`);
          return Promise.reject();
        }
        return run(() => supplierOrdersApi.splitLine(order.id, ln.id, keep as number), 'Line split');
      },
    });
  };

  const removeLine = (ln: MaterialPurchase) =>
    run(() => supplierOrdersApi.removeLine(order.id, ln.id), 'Line removed').catch(() => {});

  const openEdit = (ln: MaterialPurchase) => {
    setEditLine(ln);
    setEditValues({
      quantity: ln.quantity,
      unitCost: ln.unitCost,
      gradeOrSpec: ln.gradeOrSpec || '',
    });
  };

  const saveEdit = async () => {
    if (!editLine) return;
    if (!editValues.quantity || editValues.unitCost == null) {
      message.error('Quantity and unit cost are required');
      return;
    }
    try {
      await run(
        () =>
          supplierOrdersApi.updateLine(order.id, editLine.id, {
            quantity: editValues.quantity as number,
            unitCost: editValues.unitCost as number,
            gradeOrSpec: editValues.gradeOrSpec.trim() || null,
          }),
        'Line updated'
      );
      setEditLine(null);
    } catch {
      /* message already shown */
    }
  };

  const columns: TableColumnsType<MaterialPurchase> = [
    {
      title: 'Job',
      key: 'job',
      width: 170,
      render: (_: unknown, ln) => (
        <div>
          <Link to={`/job-orders/${ln.jobOrderId}`} style={{ fontWeight: 600 }}>
            {ln.jobNumber}
          </Link>
          <div style={{ fontSize: 11, color: '#64748b' }}>{ln.jobTitle}</div>
        </div>
      ),
    },
    {
      title: 'Material',
      key: 'material',
      render: (_: unknown, ln) => (
        <div style={ln.cancelledAt ? { textDecoration: 'line-through', color: '#94a3b8' } : undefined}>
          {ln.materialName}
          {!ln.plannedMaterialId ? (
            <div style={{ fontSize: 11, color: '#64748b' }}>Unplanned</div>
          ) : null}
        </div>
      ),
    },
    { title: 'Grade / spec', dataIndex: 'gradeOrSpec', width: 130, render: (v) => v || '—' },
    {
      title: 'Qty',
      key: 'qty',
      width: 100,
      render: (_: unknown, ln) => fmtQty(ln.quantity, ln.unit),
    },
    {
      title: 'Unit cost',
      dataIndex: 'unitCost',
      width: 110,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Amount',
      dataIndex: 'lineTotal',
      width: 120,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: unknown, ln) => {
        const p = LINE_STATUS_PILL[ln.status || 'ORDERED'] || LINE_STATUS_PILL.ORDERED;
        return (
          <StatusPill color={p.color} compact>
            {p.label}
          </StatusPill>
        );
      },
    },
    {
      title: 'Received',
      dataIndex: 'dateReceived',
      width: 110,
      render: (v) => fmtDay(v),
    },
    {
      title: '',
      key: 'act',
      width: 90,
      render: (_: unknown, ln) => {
        if (!isOfficeStaff) return null;
        if (isDraft) {
          return (
            <Space size={0}>
              <Tooltip title="Edit line">
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(ln)} />
              </Tooltip>
              <Tooltip title="Remove line">
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  disabled={busy}
                  onClick={() => removeLine(ln)}
                />
              </Tooltip>
            </Space>
          );
        }
        if (!receivable || ln.cancelledAt || ln.dateReceived) return null;
        return (
          <Space size={0}>
            <Tooltip title="Split for a partial delivery">
              <Button size="small" type="text" icon={<ScissorOutlined />} onClick={() => splitLine(ln)} />
            </Tooltip>
            <Tooltip title="Cancel line">
              <Button size="small" type="text" danger icon={<StopOutlined />} onClick={() => cancelLine(ln)} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplier-orders')}>
            Supplier orders
          </Button>
          <span style={{ fontWeight: 800, fontSize: 18 }}>
            {order.poNumber || 'Draft order'} · {order.supplierName}
          </span>
          <StatusPill color={pill.color}>{pill.label}</StatusPill>
        </Space>
        <Space wrap>
          {editableDraft ? (
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              Add lines
            </Button>
          ) : null}
          {isDraft ? (
            <Tooltip
              title={isOfficeStaff ? undefined : 'Only Office Staff can issue a supplier order.'}
            >
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!isOfficeStaff || busy || lines.length === 0 || draftDirty}
                onClick={issue}
              >
                Issue order
              </Button>
            </Tooltip>
          ) : null}
          {receivableByMe ? (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              disabled={!toReceive.length || busy}
              onClick={receiveSelected}
            >
              Receive selected
            </Button>
          ) : null}
          <Button icon={<PrinterOutlined />} onClick={() => navigate(`/supplier-orders/${order.id}/print`)}>
            Print PO
          </Button>
          {isOfficeStaff && (order.status === 'DRAFT' || order.status === 'ISSUED') ? (
            <Button danger icon={<StopOutlined />} disabled={busy} onClick={cancelOrder}>
              Cancel order
            </Button>
          ) : null}
        </Space>
      </div>

      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, md: 3 }}
        style={{ marginBottom: 16, background: '#fff' }}
        items={[
          { key: 'po', label: 'PO number', children: order.poNumber || 'Assigned on issue' },
          { key: 'issued', label: 'Date issued', children: fmtDay(order.dateIssued) },
          {
            key: 'exp',
            label: 'Expected delivery',
            children: (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {!order.expectedDeliveryDate ? (
                    `Issue date + ${order.supplierLeadTimeDays ?? '—'} days`
                  ) : order.originalExpectedDeliveryDate ? (
                    <>
                      <div>
                        <span style={{ color: '#64748b' }}>Currently expected:</span>{' '}
                        <strong>{fmtDay(order.expectedDeliveryDate)}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>Originally expected:</span>{' '}
                        {fmtDay(order.originalExpectedDeliveryDate)}
                      </div>
                    </>
                  ) : (
                    fmtDay(order.expectedDeliveryDate)
                  )}
                  {order.daysOverdue ? (
                    <div style={{ marginTop: 4 }}>
                      <OverdueTag
                        days={order.daysOverdue}
                        tooltip="Not received by the expected date. Follow up with the supplier."
                      />
                    </div>
                  ) : null}
                </div>
                {receivable ? (
                  <Tooltip
                    title={
                      isOfficeStaff
                        ? 'Change expected delivery date'
                        : 'Only Office Staff can change the expected delivery date.'
                    }
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label="Change expected delivery date"
                      disabled={!isOfficeStaff || busy}
                      onClick={openDateChange}
                    />
                  </Tooltip>
                ) : null}
              </div>
            ),
          },
          { key: 'prep', label: 'Prepared by', children: order.preparedByName || '—' },
          { key: 'iss', label: 'Issued by', children: order.issuedByName || '—' },
          { key: 'rec', label: 'Received', children: fmtDay(order.receivedDate) },
          { key: 'sub', label: 'Subtotal', children: fmtMoney(order.subtotal) },
          {
            key: 'vat',
            label: 'VAT',
            children: editableDraft ? (
              <InputNumber
                size="small"
                min={0}
                max={100}
                placeholder="None"
                value={vatRate}
                onChange={(v) => setVatRate(v)}
                addonAfter="%"
                style={{ width: 120 }}
              />
            ) : order.vatRate ? (
              `${order.vatRate}%`
            ) : (
              'None'
            ),
          },
          {
            key: 'notes',
            label: 'Notes',
            children: editableDraft ? (
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : (
              order.notes || '—'
            ),
          },
        ]}
      />

      {order.expectedDeliveryChanges && order.expectedDeliveryChanges.length > 0 ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            Expected delivery changes
          </div>
          {order.expectedDeliveryChanges.map((c, i) => (
            <div
              key={`${c.changedAt}-${i}`}
              style={{
                fontSize: 13,
                padding: '6px 0',
                borderTop: i ? '1px solid #f1f5f9' : undefined,
              }}
            >
              <div>
                {fmtDay(c.from)} → <strong>{fmtDay(c.to)}</strong>
                {c.note ? <span style={{ color: '#334155' }}> · {c.note}</span> : null}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {c.changedByName || 'Unknown'}
                {c.changedAt ? `, ${formatShop(c.changedAt, 'D MMM YYYY, h:mm A')}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {draftDirty ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Notes or VAT changed"
          action={
            <Button
              size="small"
              type="primary"
              loading={busy}
              onClick={() =>
                run(() => supplierOrdersApi.update(order.id, { notes, vatRate }), 'Order saved').catch(
                  () => {}
                )
              }
            >
              Save
            </Button>
          }
        />
      ) : null}

      {!isDraft && order.status !== 'CANCELLED' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Lines are locked after issue. Cancel a line instead of editing it; split a line when only part of it arrived."
        />
      ) : null}

      <Table<MaterialPurchase>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={lines}
        columns={columns}
        locale={{ emptyText: editableDraft ? 'No lines yet. Add lines to this draft.' : 'No lines yet.' }}
        rowSelection={
          receivableByMe
            ? {
                selectedRowKeys: toReceive,
                onChange: (keys) => setToReceive(keys as string[]),
                getCheckboxProps: (ln) => ({ disabled: !!ln.cancelledAt || !!ln.dateReceived }),
              }
            : undefined
        }
      />

      <OrderMaterialsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultSupplierId={order.supplierId}
        onSaved={(saved) => {
          setAddOpen(false);
          if (saved.id === order.id) void load();
          else navigate(`/supplier-orders/${saved.id}`);
        }}
      />

      <Modal
        open={dateOpen}
        onCancel={() => setDateOpen(false)}
        onOk={saveDateChange}
        okText="Save"
        okButtonProps={{ disabled: !newDate || !dateNote.trim() }}
        confirmLoading={busy}
        title="Change expected delivery date"
        destroyOnHidden
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#475569' }}>
            Applies to every line on this order that has not been received. A later date moves
            affected jobs later; an earlier date moves nothing.
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
              New expected delivery date
            </div>
            <DatePicker
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
              allowClear={false}
              value={newDate}
              onChange={(d) => setNewDate(d)}
              disabledDate={(d) =>
                !!order.dateIssued && d.isBefore(dayjs(order.dateIssued), 'day')
              }
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>Note (required)</div>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={500}
              placeholder="Supplier confirmed delivery on 15 Oct"
              value={dateNote}
              onChange={(e) => setDateNote(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editLine}
        onCancel={() => setEditLine(null)}
        onOk={saveEdit}
        okText="Save"
        confirmLoading={busy}
        title={editLine ? `Edit ${editLine.materialName} (${editLine.jobNumber})` : ''}
        destroyOnHidden
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>Grade / spec</div>
            <Input
              value={editValues.gradeOrSpec}
              onChange={(e) => setEditValues((v) => ({ ...v, gradeOrSpec: e.target.value }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>Quantity</div>
            <InputNumber
              min={0.0001}
              style={{ width: '100%' }}
              value={editValues.quantity}
              addonAfter={editLine?.unit}
              onChange={(q) => setEditValues((v) => ({ ...v, quantity: q }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>Unit cost</div>
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              value={editValues.unitCost}
              onChange={(c) => setEditValues((v) => ({ ...v, unitCost: c }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
