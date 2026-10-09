import { formatShop, shopToday } from '../../utils/shopTime';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import { type Dayjs } from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
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

const { Text } = Typography;

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

function bucketQuantity(b: MaterialStockBucket) {
  if (!b.quantityByUnit.length) return '0';
  return b.quantityByUnit
    .map((q) => `${Number(q.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${q.unit}`)
    .join(' · ');
}

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

  const columns: TableColumnsType<MaterialPurchase> = [
    {
      title: 'Material',
      dataIndex: 'materialName',
      width: 220,
      fixed: 'left',
      ellipsis: true,
      sorter: (a, b) => a.materialName.localeCompare(b.materialName),
      render: (n: string) => (
        <span style={{ fontWeight: 600, color: '#0f172a' }}>{n}</span>
      ),
    },
    {
      title: 'Grade / spec',
      dataIndex: 'gradeOrSpec',
      width: 130,
      ellipsis: true,
      render: (v: string | null) => v || '—',
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
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Raw materials are bought for specific job orders, not kept as general stock. On hand means delivered and waiting for its job to start; lines become consumed automatically when the job's first operation starts."
        action={
          <Link to="/analytics/suppliers">
            <Button size="small" type="link" icon={<LinkOutlined />}>
              Analytics · Suppliers
            </Button>
          </Link>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {[
          { label: 'On order', bucket: summary.onOrder ?? EMPTY_BUCKET },
          { label: 'On hand', bucket: summary.onHand ?? EMPTY_BUCKET },
          { label: 'Consumed', bucket: summary.consumed ?? EMPTY_BUCKET },
          {
            label: 'Total spend',
            value: money(summary.totalSpend),
            sub: `${summary.purchaseCount} purchase line${summary.purchaseCount === 1 ? '' : 's'}`,
          },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {c.label}
              {'bucket' in c && c.bucket ? ` · ${c.bucket.count} line${c.bucket.count === 1 ? '' : 's'}` : ''}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f1c2e' }}>
              {'bucket' in c && c.bucket ? money(c.bucket.value) : c.value}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {'bucket' in c && c.bucket ? bucketQuantity(c.bucket) : c.sub}
            </div>
          </div>
        ))}
      </div>

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

      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        For spend by material or supplier, see{' '}
        <Link to="/analytics/suppliers">Analytics → Suppliers</Link>.
      </Text>

      <Table
        className="std-list-table raw-materials-table"
        rowKey="id"
        loading={loading}
        dataSource={rows}
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
