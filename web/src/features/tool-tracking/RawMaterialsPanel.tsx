import { formatShop, shopToday } from '../../utils/shopTime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Input, Modal, Select, Tooltip, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import { type Dayjs } from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { Flag, Package, ShoppingCart, Truck } from 'lucide-react';
import { inventoryApi } from '../../api/tools.api';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { suppliersApi } from '../../api/suppliers.api';
import { getErrorMessage } from '../../api/client';
import OverdueTag from '../../components/OverdueTag';
import StatusPill from '../../components/StatusPill';
import type { PillColor } from '../../components/StatusPill';
import type {
  MaterialPurchase,
  MaterialPurchaseList,
  MaterialPurchaseStatus,
  MaterialStockBucket,
  Supplier,
} from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { useAuth } from '../../hooks/useAuth';
import ResponsiveTable from '../../components/ui/ResponsiveTable';
import {
  CategoryTile,
  InventorySummaryCards,
  type InventorySummaryCard,
} from './inventoryLook';
import { formatPoMaterialLabel } from '../../components/MaterialInputs';

function money(v: number | null | undefined) {
  if (v == null) return '—';
  return `₱${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_PILL: Record<MaterialPurchaseStatus, { color: PillColor; label: string }> = {
  DRAFT: { color: 'gray', label: 'On draft PO' },
  ORDERED: { color: 'amber', label: 'Ordered' },
  RECEIVED: { color: 'green', label: 'Received' },
  CONSUMED: { color: 'gray', label: 'Consumed' },
  CANCELLED: { color: 'red', label: 'Cancelled' },
};

function purchaseStatus(r: MaterialPurchase): MaterialPurchaseStatus {
  if (r.status === 'ORDERED' || r.status === 'RECEIVED' || r.status === 'CONSUMED') {
    return r.status;
  }
  if (r.consumedAt) return 'CONSUMED';
  return r.dateReceived ? 'RECEIVED' : 'ORDERED';
}

const EMPTY_BUCKET: MaterialStockBucket = { count: 0, value: 0, quantityByUnit: [] };

export default function RawMaterialsPanel() {
  const navigate = useNavigate();
  const { isOfficeStaff: canEdit } = useAuth();
  const [rows, setRows] = useState<MaterialPurchase[]>([]);
  const [summary, setSummary] = useState<MaterialPurchaseList['summary']>({
    purchaseCount: 0,
    totalSpend: 0,
    awaitingDeliveryCount: 0,
    onOrder: EMPTY_BUCKET,
    onHand: EMPTY_BUCKET,
    consumed: EMPTY_BUCKET,
  });
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [material, setMaterial] = useState('');
  const [status, setStatus] = useState<MaterialPurchaseStatus | 'OVERDUE' | undefined>();
  const [summaryKey, setSummaryKey] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await inventoryApi.materialPurchases({
        from: range?.[0]?.format('YYYY-MM-DD'),
        to: range?.[1]?.format('YYYY-MM-DD'),
        supplierId,
        material: material.trim() || undefined,
        status,
      });
      setRows(data.items);
      setSummary(data.summary);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range, supplierId, material, status]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    suppliersApi
      .list({ activeOnly: false })
      .then(({ data }) => setSuppliers(data))
      .catch(() => setSuppliers([]));
  }, []);

  const markReceived = (row: MaterialPurchase) => {
    let receivedDate = shopToday();
    Modal.confirm({
      title: `Mark “${row.materialName}” received?`,
      content: (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>Date received</div>
          <DatePicker
            style={{ width: '100%' }}
            defaultValue={shopToday()}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => {
              if (d) receivedDate = d;
            }}
          />
        </div>
      ),
      okText: 'Mark received',
      onOk: async () => {
        try {
          await jobOrdersApi.updateMaterialPurchase(row.jobOrderId!, row.id, {
            dateReceived: receivedDate.format('YYYY-MM-DD'),
          });
          message.success('Marked received');
          await fetchRows();
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
        }
      },
    });
  };

  const rawCards: InventorySummaryCard[] = useMemo(
    () => [
      {
        key: 'awaiting',
        label: 'Awaiting delivery',
        value: summary.awaitingDeliveryCount || 0,
        icon: Truck,
        tone: 'amber',
      },
      {
        key: 'received_month',
        label: 'Received this month',
        value: summary.receivedThisMonthCount || 0,
        icon: Package,
        tone: 'green',
      },
      {
        key: 'jobs_waiting',
        label: 'Jobs waiting on materials',
        value: summary.jobsWaitingOnMaterialsCount || 0,
        icon: ShoppingCart,
        tone: 'blue',
      },
      {
        key: 'review',
        label: 'Flagged for review after cancel',
        value: summary.reviewAfterJobCancelCount || 0,
        icon: Flag,
        tone: 'red',
      },
    ],
    [summary]
  );

  const visibleRows = useMemo(() => {
    if (summaryKey === 'awaiting') return rows.filter((r) => !r.dateReceived && r.status !== 'CANCELLED');
    if (summaryKey === 'review') return rows.filter((r) => r.reviewAfterJobCancel);
    return rows;
  }, [rows, summaryKey]);

  const columns: TableColumnsType<MaterialPurchase> = [
    {
      title: 'Material',
      dataIndex: 'materialName',
      width: 260,
      fixed: 'left',
      ellipsis: true,
      sorter: (a, b) => a.materialName.localeCompare(b.materialName),
      render: (_: string, r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CategoryTile category={r.materialName} />
          <span style={{ fontWeight: 600, color: '#0f172a' }}>
            {formatPoMaterialLabel(r.materialName, r.gradeOrSpec, r.sizeSpec)}
          </span>
        </div>
      ),
    },
    {
      title: 'Qty',
      key: 'qty',
      width: 100,
      render: (_: unknown, r) => `${r.quantity} ${r.unit}`,
    },
    {
      title: 'Unit cost',
      dataIndex: 'unitCost',
      width: 110,
      align: 'right',
      render: (v: number) => money(v),
    },
    {
      title: 'Total',
      dataIndex: 'lineTotal',
      width: 110,
      align: 'right',
      render: (v: number | null, r) => money(v ?? r.quantity * r.unitCost),
    },
    {
      title: 'Supplier',
      dataIndex: 'supplierName',
      width: 130,
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Job order',
      dataIndex: 'jobNumber',
      width: 130,
      render: (n: string | null, r) =>
        r.jobOrderId ? (
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', fontWeight: 600 }}
            onClick={() => navigate(`/job-orders/${r.jobOrderId}`)}
          >
            {n || r.jobOrderId.slice(0, 8)}
          </Button>
        ) : (
          '—'
        ),
    },
    {
      title: 'Supplier order',
      key: 'po',
      width: 140,
      render: (_: unknown, r) =>
        r.supplierOrderId ? (
          <Button
            type="link"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => navigate(`/supplier-orders/${r.supplierOrderId}`)}
          >
            {r.poNumber}
          </Button>
        ) : (
          <Tooltip title="Recorded without a supplier order">
            <span style={{ fontSize: 12, color: '#64748b' }}>No PO</span>
          </Tooltip>
        ),
    },
    {
      title: 'Ordered',
      dataIndex: 'dateOrdered',
      width: 110,
      render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
    },
    {
      title: 'Received',
      dataIndex: 'dateReceived',
      width: 110,
      render: (v: string | null) => (v ? formatShop(v, 'MMM D, YYYY') : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 190,
      render: (_: string, r) => {
        const pill = STATUS_PILL[purchaseStatus(r)];
        return (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill color={pill.color} compact>
              {pill.label}
            </StatusPill>
            <OverdueTag
              days={r.daysOverdue}
              tooltip={
                r.currentExpectedDate
                  ? `Expected ${formatShop(r.currentExpectedDate, 'MMM D, YYYY')} and not received yet.`
                  : undefined
              }
            />
          </span>
        );
      },
    },
    {
      title: '',
      key: 'act',
      width: 110,
      render: (_: unknown, r) => {
        if (!canEdit || r.dateReceived || r.status === 'CANCELLED') return null;
        if (r.supplierOrderId) {
          return r.status === 'DRAFT' ? null : (
            <Tooltip title="Deliveries arrive complete: receive the whole order on its page.">
              <Link to={`/supplier-orders/${r.supplierOrderId}`}>Receive order</Link>
            </Tooltip>
          );
        }
        return r.jobOrderId ? (
          <Button size="small" onClick={() => markReceived(r)}>
            Received
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <div>
      <InventorySummaryCards
        cards={rawCards}
        activeKey={summaryKey}
        onSelect={(key) => {
          setSummaryKey(key);
          if (key === 'awaiting') setStatus('ORDERED');
          else if (key === null) setStatus(undefined);
        }}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="Bought per job order — not general stock. On hand waits for the job to start; consumed when the first operation begins."
        action={
          <Link to="/analytics/suppliers">
            <Button size="small" type="link" icon={<LinkOutlined />}>
              Spend by supplier
            </Button>
          </Link>
        }
      />

      <div className="std-list-toolbar" style={{ marginBottom: 12 }}>
        <div className="std-list-filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <DatePicker.RangePicker
            value={range}
            allowClear
            format="YYYY-MM-DD"
            onChange={(vals) => {
              if (vals?.[0] && vals?.[1]) {
                setRange([vals[0].startOf('day'), vals[1].endOf('day')]);
              } else {
                setRange(null);
              }
            }}
            placeholder={['Ordered from', 'to']}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Supplier"
            style={{ minWidth: 160 }}
            value={supplierId}
            onChange={(v) => setSupplierId(v)}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Input
            allowClear
            placeholder="Material"
            style={{ width: 180 }}
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          />
          <Select
            allowClear
            placeholder="Status"
            style={{ minWidth: 160 }}
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              {
                value: 'OVERDUE',
                label: `Overdue${summary.overdueCount ? ` (${summary.overdueCount})` : ''}`,
              },
              { value: 'ORDERED', label: 'Ordered' },
              { value: 'RECEIVED', label: 'Received (on hand)' },
              { value: 'CONSUMED', label: 'Consumed' },
            ]}
          />
        </div>
        <div className="std-list-actions">
          <Button
            icon={<DownloadOutlined />}
            disabled={!rows.length}
            onClick={() =>
              exportCsv('raw-material-purchases.csv', rows, [
                { key: 'material', header: 'Material', value: (r) => r.materialName },
                { key: 'grade', header: 'GradeOrSpec', value: (r) => r.gradeOrSpec },
                { key: 'qty', header: 'Quantity', value: (r) => r.quantity },
                { key: 'unit', header: 'Unit', value: (r) => r.unit },
                { key: 'unitCost', header: 'UnitCost', value: (r) => r.unitCost },
                {
                  key: 'total',
                  header: 'TotalCost',
                  value: (r) => r.lineTotal ?? r.quantity * r.unitCost,
                },
                { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
                { key: 'job', header: 'JobOrder', value: (r) => r.jobNumber },
                { key: 'ordered', header: 'DateOrdered', value: (r) => r.dateOrdered },
                { key: 'received', header: 'DateReceived', value: (r) => r.dateReceived },
                {
                  key: 'status',
                  header: 'Status',
                  value: (r) => purchaseStatus(r),
                },
                { key: 'consumed', header: 'ConsumedAt', value: (r) => r.consumedAt },
              ])
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      <ResponsiveTable
        className="std-list-table raw-materials-table"
        rowKey="id"
        loading={loading}
        dataSource={visibleRows}
        columns={columns}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1510 }}
        sticky={{
          offsetHeader: 0,
          getContainer: () =>
            (document.querySelector('.app-shell__scroll') as HTMLElement | null) ?? window,
        }}
        locale={{ emptyText: 'No material purchases match these filters.' }}
      />
    </div>
  );
}
