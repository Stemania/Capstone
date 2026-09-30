import { useCallback, useEffect, useState } from 'react';
import { Button, Segmented, Table, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import type { SupplierOrder, SupplierOrderStatus } from '../../types';
import OrderMaterialsModal from './OrderMaterialsModal';
import { ORDER_STATUS_PILL, fmtDay, fmtMoney } from './supplierOrderUi';

type Filter = 'ALL' | SupplierOrderStatus;

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Issued', value: 'ISSUED' },
  { label: 'Partly received', value: 'PARTIALLY_RECEIVED' },
  { label: 'Received', value: 'RECEIVED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export default function SupplierOrdersPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [newOpen, setNewOpen] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supplierOrdersApi.list(
        filter === 'ALL' ? undefined : { status: filter }
      );
      setRows(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const columns: TableColumnsType<SupplierOrder> = [
    {
      title: 'PO #',
      key: 'po',
      width: 150,
      render: (_: unknown, r) =>
        r.poNumber ? (
          <span style={{ fontWeight: 600 }}>{r.poNumber}</span>
        ) : (
          <span style={{ color: '#64748b' }}>Not issued</span>
        ),
    },
    { title: 'Supplier', dataIndex: 'supplierName' },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 130,
      render: (v: SupplierOrderStatus) => (
        <StatusPill color={ORDER_STATUS_PILL[v].color} compact>
          {ORDER_STATUS_PILL[v].label}
        </StatusPill>
      ),
    },
    {
      title: 'Lines',
      key: 'lines',
      width: 110,
      render: (_: unknown, r) =>
        `${r.lineCount} (${r.jobCount} job${r.jobCount === 1 ? '' : 's'})`,
    },
    { title: 'Issued', dataIndex: 'dateIssued', width: 120, render: (v) => fmtDay(v) },
    {
      title: 'Expected',
      dataIndex: 'expectedDeliveryDate',
      width: 120,
      render: (v) => fmtDay(v),
    },
    {
      title: 'Subtotal',
      dataIndex: 'subtotal',
      width: 130,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    { title: 'Prepared by', dataIndex: 'preparedByName', width: 140 },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Segmented<Filter> options={FILTERS} value={filter} onChange={setFilter} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
          New supplier order
        </Button>
      </div>

      <Table
        className="std-list-table"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 20 }}
        onRow={(r) => ({
          onClick: () => navigate(`/supplier-orders/${r.id}`),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: 'No supplier orders yet.' }}
      />

      <OrderMaterialsModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSaved={(order) => {
          setNewOpen(false);
          navigate(`/supplier-orders/${order.id}`);
        }}
      />
    </div>
  );
}
