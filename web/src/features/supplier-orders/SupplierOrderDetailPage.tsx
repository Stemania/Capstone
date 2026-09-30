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
import StatusPill from '../../components/StatusPill';
import type { MaterialPurchase, SupplierOrder } from '../../types';
import OrderMaterialsModal from './OrderMaterialsModal';
import { LINE_STATUS_PILL, ORDER_STATUS_PILL, fmtDay, fmtMoney, fmtQty } from './supplierOrderUi';

function askDate(title: string, intro: string, okText: string, onOk: (d: string) => Promise<void>) {
  let picked: Dayjs = dayjs();
  Modal.confirm({
    title,
    content: (
      <div style={{ marginTop: 8 }}>
        <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>{intro}</div>
        <DatePicker
          style={{ width: '100%' }}
          defaultValue={dayjs()}
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
  const { isAdmin } = useAuth();
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
      setOrder(data);
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
  const draftDirty =
    isDraft && ((order.notes || '') !== notes || (order.vatRate ?? null) !== vatRate);

  const issue = () =>
    askDate(
      `Issue ${order.supplierName} order?`,
      `This assigns the PO number, sets the expected delivery date from the supplier's ${
        order.supplierLeadTimeDays ?? '—'
      }-day lead time, and locks the lines. Date issued:`,
      'Issue order',
      (d) => run(() => supplierOrdersApi.issue(order.id, d), 'Order issued')
    );

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
          {isDraft ? (
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              Add lines
            </Button>
          ) : null}
          {isDraft ? (
            <Tooltip title={isAdmin ? undefined : 'Only the Admin can issue a supplier order.'}>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!isAdmin || busy || lines.length === 0 || draftDirty}
                onClick={issue}
              >
                Issue order
              </Button>
            </Tooltip>
          ) : null}
          {receivable ? (
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
          {order.status === 'DRAFT' || order.status === 'ISSUED' ? (
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
            children: order.expectedDeliveryDate
              ? fmtDay(order.expectedDeliveryDate)
              : `Issue date + ${order.supplierLeadTimeDays ?? '—'} days`,
          },
          { key: 'prep', label: 'Prepared by', children: order.preparedByName || '—' },
          { key: 'iss', label: 'Issued by', children: order.issuedByName || '—' },
          { key: 'rec', label: 'Received', children: fmtDay(order.receivedDate) },
          { key: 'sub', label: 'Subtotal', children: fmtMoney(order.subtotal) },
          {
            key: 'vat',
            label: 'VAT',
            children: isDraft ? (
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
            children: isDraft ? (
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
        locale={{ emptyText: 'No lines yet. Add lines to this draft.' }}
        rowSelection={
          receivable
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
