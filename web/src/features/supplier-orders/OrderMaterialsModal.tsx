import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { suppliersApi } from '../../api/suppliers.api';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import type {
  LowStockConsumable,
  OutstandingMaterials,
  OutstandingPlannedMaterial,
  Supplier,
  SupplierOrder,
  SupplierOrderLineInput,
  SupplierReliability,
  Tool,
} from '../../types';
import { fmtQty } from './supplierOrderUi';
import { GradeInput } from '../../components/MaterialInputs';

const { Text } = Typography;

function reliabilityColor(pct: number) {
  if (pct >= 90) return '#15803d';
  if (pct >= 70) return '#b45309';
  return '#b91c1c';
}

/** "92% on time" (on or before the date promised at issue), or "Not enough deliveries". */
function ReliabilityText({ row }: { row?: SupplierReliability }) {
  if (!row) return null;
  if (!row.enoughData || row.reliabilityPct == null) {
    return <span style={{ fontSize: 12, color: '#94a3b8' }}>{row.label}</span>;
  }
  return (
    <span
      style={{ fontSize: 12, fontWeight: 600, color: reliabilityColor(row.reliabilityPct) }}
      title={`${row.onTimeDeliveries} of ${row.dueDeliveries} deliveries on or before the promised date${
        row.lateDeliveries ? `; late ones averaged ${row.avgDaysLate} days` : ''
      }`}
    >
      {row.label}
    </span>
  );
}

type PlannedEdit = { quantity: number | null; unitCost: number | null; gradeOrSpec: string };

/** A consumable restock row: from the low-stock list, or added from the consumables list. */
type ConsumableRow = {
  toolId: string;
  name: string;
  code: string;
  unit: string;
  sizeSpec: string | null;
  shopTerm?: string | null;
  lowStock?: LowStockConsumable;
};

const rowKey = (m: OutstandingPlannedMaterial) => `${m.jobOrderId}:${m.plannedMaterialId}`;

function fromLowStock(c: LowStockConsumable): ConsumableRow {
  return {
    toolId: c.toolId,
    name: c.name,
    code: c.code,
    unit: c.unit,
    sizeSpec: c.sizeSpec,
    shopTerm: c.shopTerm,
    lowStock: c,
  };
}

/**
 * The one path for purchasing: lines go onto the chosen supplier's open draft
 * order (a new draft is started if there is none). Job materials: only planned
 * materials can be ordered; anything extra is added to the job's planned
 * materials first. Consumable restock: chosen from the consumables list,
 * starting from those at or below minimum stock. With ``jobId`` only that
 * job's materials are offered.
 */
export default function OrderMaterialsModal({
  open,
  onClose,
  onSaved,
  jobId,
  defaultSupplierId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (order: SupplierOrder) => void;
  jobId?: string;
  defaultSupplierId?: string | null;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reliability, setReliability] = useState<Record<string, SupplierReliability>>({});
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [data, setData] = useState<OutstandingMaterials | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, PlannedEdit>>({});
  const [consumables, setConsumables] = useState<Tool[]>([]);
  const [consumableRows, setConsumableRows] = useState<ConsumableRow[]>([]);
  const [selectedConsumables, setSelectedConsumables] = useState<string[]>([]);
  const [consumableEdits, setConsumableEdits] = useState<Record<string, PlannedEdit>>({});
  const offerConsumables = !jobId;

  useEffect(() => {
    if (!open) return;
    setSupplierId(defaultSupplierId || undefined);
    setSelected([]);
    setEdits({});
    setSelectedConsumables([]);
    setConsumableEdits({});
    setConsumableRows([]);
    setLoading(true);
    suppliersApi
      .reliability()
      .then(({ data: rows }) => setReliability(Object.fromEntries(rows.map((r) => [r.supplierId, r]))))
      .catch(() => setReliability({}));
    if (offerConsumables) {
      toolsApi
        .list({ category: 'CONSUMABLE' })
        .then(({ data: rows }) => setConsumables(rows))
        .catch(() => setConsumables([]));
    }
    Promise.all([suppliersApi.list({ activeOnly: true }), supplierOrdersApi.outstanding(jobId)])
      .then(([s, o]) => {
        setSuppliers(s.data);
        setData(o.data);
        const initial: Record<string, PlannedEdit> = {};
        for (const m of o.data.materials) {
          initial[rowKey(m)] = {
            quantity: m.remainingQuantity ?? 1,
            unitCost: null,
            gradeOrSpec: '',
          };
        }
        setEdits(initial);
        const low = o.data.lowStockConsumables || [];
        setConsumableRows(low.map(fromLowStock));
        setConsumableEdits(
          Object.fromEntries(
            low.map((c) => [
              c.toolId,
              {
                quantity: c.remainingSuggestedQuantity || c.suggestedOrderQuantity || 1,
                unitCost: null,
                gradeOrSpec: c.sizeSpec || '',
              },
            ])
          )
        );
      })
      .catch((err) => message.error(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [open, jobId, defaultSupplierId, offerConsumables]);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const setEdit = (key: string, patch: Partial<PlannedEdit>) =>
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const setConsumableEdit = (toolId: string, patch: Partial<PlannedEdit>) =>
    setConsumableEdits((prev) => ({ ...prev, [toolId]: { ...prev[toolId], ...patch } }));
  const addConsumable = (toolId: string) => {
    const tool = consumables.find((t) => t.id === toolId);
    if (!tool || consumableRows.some((r) => r.toolId === toolId)) return;
    setConsumableRows((prev) => [
      ...prev,
      {
        toolId: tool.id,
        name: tool.name,
        code: tool.code,
        unit: tool.unit,
        sizeSpec: tool.sizeSpec,
        shopTerm: tool.shopTerm,
      },
    ]);
    setConsumableEdit(tool.id, { quantity: 1, unitCost: null, gradeOrSpec: tool.sizeSpec || '' });
    setSelectedConsumables((prev) => [...prev, tool.id]);
  };
  const onSubmit = async () => {
    if (!supplierId) {
      message.error('Choose a supplier');
      return;
    }
    const lines: SupplierOrderLineInput[] = [];
    for (const m of data?.materials || []) {
      const key = rowKey(m);
      if (!selected.includes(key)) continue;
      const e = edits[key];
      if (!e?.quantity || e.quantity <= 0) {
        message.error(`Enter a quantity for ${m.materialName} (${m.jobNumber})`);
        return;
      }
      if (e.unitCost == null) {
        message.error(`Enter a unit cost for ${m.materialName} (${m.jobNumber})`);
        return;
      }
      lines.push({
        jobOrderId: m.jobOrderId,
        plannedMaterialId: m.plannedMaterialId,
        quantity: e.quantity,
        unitCost: e.unitCost,
        gradeOrSpec: e.gradeOrSpec.trim() || null,
      });
    }
    for (const c of consumableRows) {
      if (!selectedConsumables.includes(c.toolId)) continue;
      const e = consumableEdits[c.toolId];
      if (!e?.quantity || e.quantity <= 0) {
        message.error(`Enter a quantity for ${c.name}`);
        return;
      }
      if (e.unitCost == null) {
        message.error(`Enter a unit cost for ${c.name}`);
        return;
      }
      lines.push({
        toolId: c.toolId,
        quantity: e.quantity,
        unit: c.unit,
        unitCost: e.unitCost,
        gradeOrSpec: e.gradeOrSpec.trim() || null,
      });
    }
    if (!lines.length) {
      message.error(offerConsumables ? 'Tick at least one material or consumable' : 'Tick at least one material');
      return;
    }
    try {
      setSaving(true);
      const { data: order } = await supplierOrdersApi.addDraftLines(supplierId, lines);
      message.success(`${lines.length} line${lines.length === 1 ? '' : 's'} added to the draft order`);
      onSaved(order);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1040}
      centered
      destroyOnHidden
      footer={null}
      closable={false}
      className="app-form-modal"
      styles={{
        container: { padding: 0, borderRadius: 0, overflow: 'hidden' },
        body: { padding: 0 },
      }}
    >
      <div className="app-form-modal__head">
        <div className="app-form-modal__icon">
          <ShoppingCartOutlined />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="app-form-modal__title">
            {jobId ? 'Order materials for this job' : 'New supplier order'}
          </div>
          <div className="app-form-modal__sub">
            {offerConsumables
              ? 'Pick a supplier, then the planned materials and consumables to add to its draft order.'
              : 'Pick a supplier, then the planned materials to add to its draft order.'}
          </div>
        </div>
        <button type="button" className="app-form-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div style={{ padding: '18px 24px 12px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>Supplier</div>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Choose a supplier"
          style={{ width: 360 }}
          value={supplierId}
          onChange={setSupplierId}
          options={suppliers.map((s) => ({
            value: s.id,
            label: s.code ? `${s.name} (${s.code})` : s.name,
          }))}
          optionRender={(o) => (
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{o.label}</span>
              <ReliabilityText row={reliability[String(o.value)]} />
            </span>
          )}
          labelRender={(o) => (
            <span>
              {o.label}
              {o.value ? (
                <span style={{ marginLeft: 8 }}>
                  <ReliabilityText row={reliability[String(o.value)]} />
                </span>
              ) : null}
            </span>
          )}
        />
        {supplier ? (
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            Lead time {supplier.typicalLeadTimeDays ?? '—'} day
            {supplier.typicalLeadTimeDays === 1 ? '' : 's'}. Lines are added to this supplier&apos;s
            open draft, or a new draft is started.
          </Text>
        ) : null}
      </div>

      {supplierId ? (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0' }}>
            Planned materials still to order{jobId ? '' : ' (all open jobs)'}
          </div>
          <Table<OutstandingPlannedMaterial>
            size="small"
            loading={loading}
            rowKey={rowKey}
            pagination={false}
            scroll={{ y: 'min(320px, calc(100vh - 470px))' }}
            dataSource={data?.materials || []}
            locale={{ emptyText: 'Nothing planned is waiting to be ordered.' }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            columns={[
              ...(jobId
                ? []
                : [
                    {
                      title: 'Job',
                      key: 'job',
                      width: 170,
                      render: (_: unknown, m: OutstandingPlannedMaterial) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{m.jobNumber}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{m.jobTitle}</div>
                        </div>
                      ),
                    },
                  ]),
              { title: 'Material', dataIndex: 'materialName' },
              {
                title: 'Still to order',
                key: 'remaining',
                width: 110,
                render: (_: unknown, m) => fmtQty(m.remainingQuantity, m.unit),
              },
              {
                title: 'Grade / spec',
                key: 'grade',
                width: 140,
                render: (_: unknown, m) => (
                  <GradeInput
                    size="small"
                    placeholder=""
                    materialName={m.materialName}
                    value={edits[rowKey(m)]?.gradeOrSpec}
                    onChange={(v) => setEdit(rowKey(m), { gradeOrSpec: v })}
                  />
                ),
              },
              {
                title: 'Quantity',
                key: 'qty',
                width: 130,
                render: (_: unknown, m) => (
                  <InputNumber
                    size="small"
                    min={0.0001}
                    style={{ width: '100%' }}
                    value={edits[rowKey(m)]?.quantity}
                    onChange={(v) => setEdit(rowKey(m), { quantity: v })}
                    addonAfter={m.unit}
                  />
                ),
              },
              {
                title: 'Unit cost',
                key: 'cost',
                width: 120,
                render: (_: unknown, m) => (
                  <InputNumber
                    size="small"
                    min={0}
                    style={{ width: '100%' }}
                    value={edits[rowKey(m)]?.unitCost}
                    onChange={(v) => setEdit(rowKey(m), { unitCost: v })}
                  />
                ),
              },
            ]}
          />

          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
            Only planned materials can be ordered. To order something else, add it to the
            job&apos;s planned materials first (Edit on the job order).
          </Text>

          {offerConsumables ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  margin: '18px 0 8px',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Consumables to restock (not tied to a job)
                </div>
                <Select
                  showSearch
                  size="small"
                  optionFilterProp="label"
                  placeholder="Add another consumable"
                  style={{ width: 280 }}
                  value={null}
                  onChange={(v: string) => addConsumable(v)}
                  options={consumables
                    .filter((t) => !consumableRows.some((r) => r.toolId === t.id))
                    .map((t) => ({
                      value: t.id,
                      label: `${t.name}${t.shopTerm ? ` “${t.shopTerm}”` : ''} (${t.code})`,
                    }))}
                />
              </div>
              <Table<ConsumableRow>
                size="small"
                loading={loading}
                rowKey="toolId"
                pagination={false}
                scroll={{ y: 'min(260px, calc(100vh - 520px))' }}
                dataSource={consumableRows}
                locale={{ emptyText: 'No consumable is at or below its minimum stock.' }}
                rowSelection={{
                  selectedRowKeys: selectedConsumables,
                  onChange: (keys) => setSelectedConsumables(keys as string[]),
                }}
                columns={[
                  {
                    title: 'Consumable',
                    key: 'name',
                    render: (_: unknown, c) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {[c.shopTerm && `“${c.shopTerm}”`, c.code].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: 'Stock',
                    key: 'stock',
                    width: 190,
                    render: (_: unknown, c) =>
                      c.lowStock ? (
                        <div style={{ fontSize: 12 }}>
                          <span style={{ color: '#b45309', fontWeight: 600 }}>
                            {fmtQty(c.lowStock.quantityOnHand, c.unit)}
                          </span>{' '}
                          of min {fmtQty(c.lowStock.minimumStock, c.unit)}
                          {c.lowStock.onOrderQuantity > 0 ? (
                            <div style={{ color: '#64748b' }}>
                              {fmtQty(c.lowStock.onOrderQuantity, c.unit)} already on order
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#64748b' }}>Added</span>
                      ),
                  },
                  {
                    title: 'Size / spec',
                    key: 'grade',
                    width: 130,
                    render: (_: unknown, c) => (
                      <Input
                        size="small"
                        value={consumableEdits[c.toolId]?.gradeOrSpec}
                        onChange={(e) => setConsumableEdit(c.toolId, { gradeOrSpec: e.target.value })}
                      />
                    ),
                  },
                  {
                    title: 'Quantity',
                    key: 'qty',
                    width: 130,
                    render: (_: unknown, c) => (
                      <InputNumber
                        size="small"
                        min={0.01}
                        style={{ width: '100%' }}
                        value={consumableEdits[c.toolId]?.quantity}
                        onChange={(v) => setConsumableEdit(c.toolId, { quantity: v })}
                        addonAfter={c.unit}
                      />
                    ),
                  },
                  {
                    title: 'Unit cost',
                    key: 'cost',
                    width: 120,
                    render: (_: unknown, c) => (
                      <InputNumber
                        size="small"
                        min={0}
                        style={{ width: '100%' }}
                        value={consumableEdits[c.toolId]?.unitCost}
                        onChange={(v) => setConsumableEdit(c.toolId, { unitCost: v })}
                      />
                    ),
                  },
                ]}
              />
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
                Quantities start at the suggested order quantity. Receiving a consumable line on the
                order adds it to stock.
              </Text>
            </>
          ) : null}
        </>
      ) : (
        <Alert type="info" showIcon message="Choose a supplier to see the materials still to order." />
      )}
      </div>

      <div className="app-form-modal__footer">
        <Button onClick={onClose} style={{ minWidth: 96 }}>
          Cancel
        </Button>
        <Button
          type="primary"
          loading={saving}
          onClick={onSubmit}
          disabled={!supplierId}
          style={{ fontWeight: 700, minWidth: 120 }}
        >
          Save to draft order
        </Button>
      </div>
    </Modal>
  );
}
