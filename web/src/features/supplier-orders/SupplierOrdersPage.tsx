import { useCallback, useEffect, useState } from 'react';
import { Button, Segmented, Table, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import OverdueTag from '../../components/OverdueTag';
import { useAuth } from '../../hooks/useAuth';
import { useOverdueCheck } from '../../hooks/useOverdueCheck';
import type { SupplierOrder, SupplierOrderStatus } from '../../types';
import OrderMaterialsModal from './OrderMaterialsModal';
import { ORDER_STATUS_PILL, fmtDay, fmtMoney } from './supplierOrderUi';

type Filter = 'ALL' | 'OVERDUE' | SupplierOrderStatus;

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Overdue', value: 'OVERDUE' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Issued', value: 'ISSUED' },
  { label: 'Partly received', value: 'PARTIALLY_RECEIVED' },
  { label: 'Received', value: 'RECEIVED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export default function SupplierOrdersPage() {
  const navigate = useNavigate();
  const { isOfficeStaff } = useAuth();
  const [rows, setRows] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [newOpen, setNewOpen] = useState(false);
  useOverdueCheck();

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
    { title: 'Supplier', dataIndex: 'supplierName', width: 200, ellipsis: true },
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
      width: 150,
      render: (_: unknown, r) => {
        const parts = [];
        if (r.jobCount) parts.push(`${r.jobCount} job${r.jobCount === 1 ? '' : 's'}`);
        if (r.consumableLineCount) parts.push(`${r.consumableLineCount} consumable`);
        return `${r.lineCount}${parts.length ? ` (${parts.join(', ')})` : ''}`;
      },
    },
    { title: 'Issued', dataIndex: 'dateIssued', width: 120, render: (v) => fmtDay(v) },
    {
      title: 'Expected',
      dataIndex: 'expectedDeliveryDate',
      width: 150,
      render: (v, r) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {fmtDay(v)}
          <OverdueTag days={r.daysOverdue} tooltip="Not received by the expected date. Follow up with the supplier." />
        </span>
      ),
    },
    {
      title: 'Subtotal',
      dataIndex: 'subtotal',
      width: 130,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    { title: 'Prepared by', dataIndex: 'preparedByName', width: 140, ellipsis: true },
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
        {isOfficeStaff && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
            New supplier order
          </Button>
        )}
      </div>

      <Table
        className="std-list-table"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20 }}
        onRow={(r) => ({
          onClick: () => navigate(`/supplier-orders/${r.id}`),
          style: { cursor: 'pointer' },
        })}
        locale={{
          emptyText: filter === 'OVERDUE' ? 'No overdue supplier orders.' : 'No supplier orders yet.',
        }}
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
