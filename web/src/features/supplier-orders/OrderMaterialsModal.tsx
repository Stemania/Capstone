import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { suppliersApi } from '../../api/suppliers.api';
import { toolsApi } from '../../api/tools.api';
import { MATERIAL_UNITS } from '../../api/materialCatalog.api';
import { getErrorMessage } from '../../api/client';
import type {
  LowStockConsumable,
  OutstandingMaterials,
  Supplier,
  SupplierOrder,
  SupplierOrderLineInput,
  SupplierReliability,
  Tool,
} from '../../types';
import { fmtDay, fmtQty } from './supplierOrderUi';
import { GradeInput, MaterialNameInput } from '../../components/MaterialInputs';

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

/** A job material line typed by Office Staff. */
type MaterialLineDraft = {
  key: number;
  jobOrderId?: string;
  materialName: string;
  gradeOrSpec: string;
  quantity: number | null;
  unit: string;
  unitCost: number | null;
};

let nextLineKey = 1;
const blankLine = (jobOrderId?: string): MaterialLineDraft => ({
  key: nextLineKey++,
  jobOrderId,
  materialName: '',
  gradeOrSpec: '',
  quantity: null,
  unit: 'pcs',
  unitCost: null,
});

const isBlank = (l: MaterialLineDraft) =>
  !l.materialName.trim() && l.quantity == null && l.unitCost == null && !l.gradeOrSpec.trim();

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
 * order (a new draft is started if there is none). Job materials: Office Staff
 * type each line (catalog suggestions, grade, quantity, unit, unit cost) for a
 * job whose materials are To order. Consumable restock: chosen from the
 * consumables list, starting from those at or below minimum stock. With
 * ``jobId`` the lines are for that job only.
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
  const [lines, setLines] = useState<MaterialLineDraft[]>([]);
  const [consumables, setConsumables] = useState<Tool[]>([]);
  const [consumableRows, setConsumableRows] = useState<ConsumableRow[]>([]);
  const [selectedConsumables, setSelectedConsumables] = useState<string[]>([]);
  const [consumableEdits, setConsumableEdits] = useState<Record<string, PlannedEdit>>({});
  const offerConsumables = !jobId;

  useEffect(() => {
    if (!open) return;
    setSupplierId(defaultSupplierId || undefined);
    setLines([blankLine(jobId)]);
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
  const jobs = data?.jobs || [];
  const setLine = (key: number, patch: Partial<MaterialLineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((prev) => [...prev, blankLine(jobId ?? prev[prev.length - 1]?.jobOrderId)]);
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));
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
    const payload: SupplierOrderLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      if (isBlank(l)) continue;
      const name = l.materialName.trim();
      const where = `line ${i + 1}`;
      if (!l.jobOrderId) {
        message.error(`Choose the job for ${where}`);
        return;
      }
      if (!name) {
        message.error(`Enter the material on ${where}`);
        return;
      }
      if (!l.quantity || l.quantity <= 0) {
        message.error(`Enter a quantity for ${name}`);
        return;
      }
      if (l.unitCost == null) {
        message.error(`Enter a unit cost for ${name}`);
        return;
      }
      payload.push({
        jobOrderId: l.jobOrderId,
        materialName: name,
        gradeOrSpec: l.gradeOrSpec.trim() || null,
        quantity: l.quantity,
        unit: l.unit,
        unitCost: l.unitCost,
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
      payload.push({
        toolId: c.toolId,
        quantity: e.quantity,
        unit: c.unit,
        unitCost: e.unitCost,
        gradeOrSpec: e.gradeOrSpec.trim() || null,
      });
    }
    if (!payload.length) {
      message.error(
        offerConsumables ? 'Enter a material line or tick a consumable' : 'Enter at least one material line'
      );
      return;
    }
    try {
      setSaving(true);
      const { data: order } = await supplierOrdersApi.addDraftLines(supplierId, payload);
      message.success(`${payload.length} line${payload.length === 1 ? '' : 's'} added to the draft order`);
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
              ? 'Pick a supplier, then type the job materials and tick the consumables to add to its draft order.'
              : 'Pick a supplier, then type the materials to add to its draft order.'}
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              margin: '8px 0',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {jobId ? 'Materials for this job' : 'Job materials'}
            </div>
            <Button size="small" icon={<PlusOutlined />} onClick={addLine} disabled={!jobs.length}>
              Add line
            </Button>
          </div>
          {!loading && !jobs.length ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message={
                jobId
                  ? "This job's materials are Not required, so nothing is ordered for it."
                  : 'No open job has materials To order.'
              }
            />
          ) : (
            <Table<MaterialLineDraft>
              size="small"
              loading={loading}
              rowKey="key"
              pagination={false}
              scroll={{ y: 'min(320px, calc(100vh - 470px))' }}
              dataSource={lines}
              locale={{ emptyText: 'Add a line for each material to order.' }}
              columns={[
                ...(jobId
                  ? []
                  : [
                      {
                        title: 'Job',
                        key: 'job',
                        width: 190,
                        render: (_: unknown, l: MaterialLineDraft) => (
                          <Select
                            size="small"
                            showSearch
                            optionFilterProp="label"
                            placeholder="Choose a job"
                            style={{ width: '100%' }}
                            value={l.jobOrderId}
                            onChange={(v: string) => setLine(l.key, { jobOrderId: v })}
                            popupMatchSelectWidth={false}
                            labelRender={(o) =>
                              jobs.find((j) => j.id === o.value)?.jobNumber ?? o.label
                            }
                            options={jobs.map((j) => ({
                              value: j.id,
                              label: `${j.jobNumber} · ${j.title}`,
                              title: [
                                j.clientName,
                                j.dueDate ? `due ${fmtDay(j.dueDate)}` : null,
                                j.notOrderedYet ? 'nothing issued yet' : null,
                              ]
                                .filter(Boolean)
                                .join(' · '),
                            }))}
                          />
                        ),
                      },
                    ]),
                {
                  title: 'Material',
                  key: 'material',
                  render: (_: unknown, l) => (
                    <MaterialNameInput
                      value={l.materialName}
                      onChange={(v) => setLine(l.key, { materialName: v })}
                      onPick={(item) => setLine(l.key, { unit: item.defaultUnit || l.unit })}
                    />
                  ),
                },
                {
                  title: 'Grade / spec',
                  key: 'grade',
                  width: 140,
                  render: (_: unknown, l) => (
                    <GradeInput
                      size="small"
                      placeholder=""
                      materialName={l.materialName}
                      value={l.gradeOrSpec}
                      onChange={(v) => setLine(l.key, { gradeOrSpec: v })}
                    />
                  ),
                },
                {
                  title: 'Quantity',
                  key: 'qty',
                  width: 100,
                  render: (_: unknown, l) => (
                    <InputNumber
                      size="small"
                      min={0.0001}
                      style={{ width: '100%' }}
                      value={l.quantity}
                      onChange={(v) => setLine(l.key, { quantity: v })}
                    />
                  ),
                },
                {
                  title: 'Unit',
                  key: 'unit',
                  width: 90,
                  render: (_: unknown, l) => (
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      value={l.unit}
                      onChange={(v: string) => setLine(l.key, { unit: v })}
                      options={MATERIAL_UNITS.map((u) => ({ value: u, label: u }))}
                    />
                  ),
                },
                {
                  title: 'Unit cost',
                  key: 'cost',
                  width: 110,
                  render: (_: unknown, l) => (
                    <InputNumber
                      size="small"
                      min={0}
                      style={{ width: '100%' }}
                      value={l.unitCost}
                      onChange={(v) => setLine(l.key, { unitCost: v })}
                    />
                  ),
                },
                {
                  title: '',
                  key: 'remove',
                  width: 40,
                  render: (_: unknown, l) => (
                    <Button
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label="Remove line"
                      onClick={() => removeLine(l.key)}
                    />
                  ),
                },
              ]}
            />
          )}

          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
            Type each material as it goes on the supplier order. Once the order is issued its
            lines are locked; to change them, cancel the order and issue a new one.
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
        <Alert type="info" showIcon message="Choose a supplier first." />
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
