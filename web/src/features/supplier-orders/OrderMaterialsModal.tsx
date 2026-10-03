import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { suppliersApi } from '../../api/suppliers.api';
import { getErrorMessage } from '../../api/client';
import type {
  OutstandingMaterials,
  OutstandingPlannedMaterial,
  Supplier,
  SupplierOrder,
  SupplierOrderLineInput,
  SupplierReliability,
} from '../../types';
import { fmtQty } from './supplierOrderUi';

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

type ExtraLine = {
  key: number;
  jobOrderId?: string;
  materialName: string;
  gradeOrSpec: string;
  quantity: number | null;
  unit: string;
  unitCost: number | null;
};

const rowKey = (m: OutstandingPlannedMaterial) => `${m.jobOrderId}:${m.plannedMaterialId}`;

/**
 * The one path for ordering materials: lines go onto the chosen supplier's
 * open draft order (a new draft is started if there is none). With ``jobId``
 * only that job's materials are offered.
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
  const [extras, setExtras] = useState<ExtraLine[]>([]);

  useEffect(() => {
    if (!open) return;
    setSupplierId(defaultSupplierId || undefined);
    setSelected([]);
    setEdits({});
    setExtras([]);
    setLoading(true);
    suppliersApi
      .reliability()
      .then(({ data: rows }) => setReliability(Object.fromEntries(rows.map((r) => [r.supplierId, r]))))
      .catch(() => setReliability({}));
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
      })
      .catch((err) => message.error(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [open, jobId, defaultSupplierId]);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const jobOptions = useMemo(
    () =>
      (data?.jobs || []).map((j) => ({ value: j.id, label: `${j.jobNumber} — ${j.title}` })),
    [data]
  );

  const setEdit = (key: string, patch: Partial<PlannedEdit>) =>
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const setExtra = (key: number, patch: Partial<ExtraLine>) =>
    setExtras((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const addExtra = () =>
    setExtras((prev) => [
      ...prev,
      {
        key: Date.now() + prev.length,
        jobOrderId: jobId,
        materialName: '',
        gradeOrSpec: '',
        quantity: 1,
        unit: 'pcs',
        unitCost: null,
      },
    ]);

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
    for (const x of extras) {
      if (!x.jobOrderId || !x.materialName.trim() || !x.quantity || x.unitCost == null) {
        message.error('Each unplanned line needs a job, material, quantity and unit cost');
        return;
      }
      lines.push({
        jobOrderId: x.jobOrderId,
        materialName: x.materialName.trim(),
        gradeOrSpec: x.gradeOrSpec.trim() || null,
        quantity: x.quantity,
        unit: x.unit.trim() || 'pcs',
        unitCost: x.unitCost,
      });
    }
    if (!lines.length) {
      message.error('Tick at least one material or add a line');
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
            Pick a supplier, then the materials to add to its draft order.
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
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
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
                  <Input
                    size="small"
                    value={edits[rowKey(m)]?.gradeOrSpec}
                    onChange={(e) => setEdit(rowKey(m), { gradeOrSpec: e.target.value })}
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              margin: '16px 0 8px',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>Unplanned lines</div>
            <Button size="small" icon={<PlusOutlined />} onClick={addExtra}>
              Add line
            </Button>
          </div>
          {extras.length ? (
            <Table<ExtraLine>
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={extras}
              columns={[
                ...(jobId
                  ? []
                  : [
                      {
                        title: 'Job',
                        key: 'job',
                        width: 200,
                        render: (_: unknown, x: ExtraLine) => (
                          <Select
                            size="small"
                            showSearch
                            optionFilterProp="label"
                            placeholder="Job order"
                            style={{ width: '100%' }}
                            value={x.jobOrderId}
                            onChange={(v) => setExtra(x.key, { jobOrderId: v })}
                            options={jobOptions}
                          />
                        ),
                      },
                    ]),
                {
                  title: 'Material',
                  key: 'name',
                  render: (_: unknown, x) => (
                    <Input
                      size="small"
                      value={x.materialName}
                      onChange={(e) => setExtra(x.key, { materialName: e.target.value })}
                    />
                  ),
                },
                {
                  title: 'Grade / spec',
                  key: 'grade',
                  width: 130,
                  render: (_: unknown, x) => (
                    <Input
                      size="small"
                      value={x.gradeOrSpec}
                      onChange={(e) => setExtra(x.key, { gradeOrSpec: e.target.value })}
                    />
                  ),
                },
                {
                  title: 'Quantity',
                  key: 'qty',
                  width: 100,
                  render: (_: unknown, x) => (
                    <InputNumber
                      size="small"
                      min={0.0001}
                      style={{ width: '100%' }}
                      value={x.quantity}
                      onChange={(v) => setExtra(x.key, { quantity: v })}
                    />
                  ),
                },
                {
                  title: 'Unit',
                  key: 'unit',
                  width: 80,
                  render: (_: unknown, x) => (
                    <Input
                      size="small"
                      value={x.unit}
                      onChange={(e) => setExtra(x.key, { unit: e.target.value })}
                    />
                  ),
                },
                {
                  title: 'Unit cost',
                  key: 'cost',
                  width: 110,
                  render: (_: unknown, x) => (
                    <InputNumber
                      size="small"
                      min={0}
                      style={{ width: '100%' }}
                      value={x.unitCost}
                      onChange={(v) => setExtra(x.key, { unitCost: v })}
                    />
                  ),
                },
                {
                  title: '',
                  key: 'rm',
                  width: 40,
                  render: (_: unknown, x) => (
                    <Button
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => setExtras((prev) => prev.filter((y) => y.key !== x.key))}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              For material that is not on a job&apos;s plan. Each line is tied to a job.
            </Text>
          )}
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
