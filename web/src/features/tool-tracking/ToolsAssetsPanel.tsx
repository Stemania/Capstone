import { formatShop, shopToday } from '../../utils/shopTime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Col,
  DatePicker,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  AppstoreAddOutlined,
  DownloadOutlined,
  HistoryOutlined,
  MoreOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { type Dayjs } from 'dayjs';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import InfoTip from '../../components/InfoTip';
import apiClient, { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import type { InventoryUsageByWorker, ToolType, ToolUnit, ToolUnitStatus } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import ToolEventsPage from './ToolEventsPage';
import { useAuth } from '../../hooks/useAuth';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

function statusPill(status: ToolUnitStatus) {
  switch (status) {
    case 'AVAILABLE':
      return <StatusPill color="green" compact>Available</StatusPill>;
    case 'OUT':
      return <StatusPill color="amber" compact>Out</StatusPill>;
    case 'UNDER_REPAIR':
      return <StatusPill color="blue" compact>Repair</StatusPill>;
    case 'RETIRED':
      return <StatusPill color="gray" compact>Retired</StatusPill>;
    default:
      return status;
  }
}

export default function ToolsAssetsPanel() {
  const { isOfficeStaff: canEdit } = useAuth();
  const [types, setTypes] = useState<ToolType[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [unitsByType, setUnitsByType] = useState<Record<string, ToolUnit[]>>({});
  const [typeModal, setTypeModal] = useState(false);
  const [unitModalType, setUnitModalType] = useState<ToolType | null>(null);
  const [receiveType, setReceiveType] = useState<ToolType | null>(null);
  const [qrUnit, setQrUnit] = useState<ToolUnit | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [typeForm] = Form.useForm();
  const [unitForm] = Form.useForm();
  const [receiveForm] = Form.useForm();
  const [creatingType, setCreatingType] = useState(false);
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [usageRange, setUsageRange] = useState<[Dayjs, Dayjs]>([
    shopToday().subtract(29, 'day').startOf('day'),
    shopToday().endOf('day'),
  ]);
  const [usage, setUsage] = useState<InventoryUsageByWorker | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await toolsApi.listTypes({ onlyWithOut: onlyOut });
      setTypes(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onlyOut]);

  const fetchUsage = async () => {
    setUsageLoading(true);
    try {
      const { data } = await inventoryApi.usageByWorker({
        from: usageRange[0].format('YYYY-MM-DD'),
        to: usageRange[1].format('YYYY-MM-DD'),
      });
      setUsage(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    void fetchTypes();
  }, [fetchTypes]);

  useEffect(() => {
    if (historyOpen) void fetchUsage();
  }, [historyOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return types;
    return types.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
    );
  }, [types, query]);

  const loadUnits = async (typeId: string) => {
    try {
      const { data } = await toolsApi.getType(typeId);
      setUnitsByType((prev) => ({ ...prev, [typeId]: data.units || [] }));
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onExpand = async (expanded: boolean, record: ToolType) => {
    if (expanded) {
      setExpandedKeys((k) => [...k, record.id]);
      await loadUnits(record.id);
    } else {
      setExpandedKeys((k) => k.filter((id) => id !== record.id));
    }
  };

  const createType = async (values: { name: string; code?: string; description?: string }) => {
    try {
      setCreatingType(true);
      await toolsApi.createType(values);
      message.success('Tool type added');
      setTypeModal(false);
      typeForm.resetFields();
      await fetchTypes();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setCreatingType(false);
    }
  };

  const createUnit = async (values: { assetCode?: string; notes?: string }) => {
    if (!unitModalType) return;
    try {
      setCreatingUnit(true);
      await toolsApi.createUnit(unitModalType.id, values);
      message.success('Unit added');
      setUnitModalType(null);
      unitForm.resetFields();
      await fetchTypes();
      await loadUnits(unitModalType.id);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setCreatingUnit(false);
    }
  };

  const onReceiveUnits = async (values: {
    quantity: number;
    supplier: string;
    receivedOn: Dayjs;
    note?: string;
  }) => {
    if (!receiveType) return;
    try {
      setReceiving(true);
      const { data } = await toolsApi.receiveUnits(receiveType.id, {
        quantity: values.quantity,
        supplier: values.supplier,
        receivedOn: values.receivedOn.format('YYYY-MM-DD'),
        note: values.note,
      });
      message.success(`Received ${data.count} unit${data.count === 1 ? '' : 's'}`);
      setReceiveType(null);
      receiveForm.resetFields();
      await fetchTypes();
      await loadUnits(receiveType.id);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setReceiving(false);
    }
  };

  const setUnitStatus = async (unit: ToolUnit, status: ToolUnitStatus) => {
    try {
      await toolsApi.updateUnit(unit.id, { status });
      message.success('Unit updated');
      await fetchTypes();
      await loadUnits(unit.toolTypeId);
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const columns: TableColumnsType<ToolType> = [
    {
      title: 'Type',
      key: 'name',
      render: (_: unknown, r) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>
            {r.name}
            {r.isSeed ? (
              <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                seed
              </Typography.Text>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{r.code}</div>
        </div>
      ),
    },
    { title: 'Total', dataIndex: 'totalUnits', width: 80, align: 'right' },
    { title: 'Available', dataIndex: 'availableCount', width: 90, align: 'right' },
    {
      title: 'Out',
      dataIndex: 'outCount',
      width: 72,
      align: 'right',
      render: (v: number) =>
        v > 0 ? <span style={{ fontWeight: 700, color: '#b45309' }}>{v}</span> : v,
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      render: (_: unknown, r) => {
        if (!canEdit) return null;
        const items: MenuProps['items'] = [
          {
            key: 'receive',
            label: 'Receive delivery',
            onClick: () => {
              setReceiveType(r);
              receiveForm.setFieldsValue({ receivedOn: shopToday(), quantity: 1 });
            },
          },
          {
            key: 'add-unit',
            label: 'Add unit',
            onClick: () => setUnitModalType(r),
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label="More" />
          </Dropdown>
        );
      },
    },
  ];

  const expandedRowRender = (record: ToolType) => {
    const units = unitsByType[record.id] || [];
    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={units}
        locale={{
          emptyText: 'No units for this type yet. Add a unit with its own asset code and QR.',
        }}
        columns={[
          {
            title: 'Asset code',
            dataIndex: 'assetCode',
            render: (c: string) => <span style={{ fontWeight: 600 }}>{c}</span>,
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 110,
            render: (s: ToolUnitStatus) => statusPill(s),
          },
          {
            title: 'Holding',
            key: 'holder',
            render: (_: unknown, u: ToolUnit) =>
              u.status === 'OUT'
                ? `${u.currentHolderName || 'Worker'}${
                    u.heldSince ? ` · since ${formatShop(u.heldSince, 'MMM D')}` : ''
                  }`
                : '—',
          },
          {
            title: '',
            key: 'uactions',
            width: 120,
            render: (_: unknown, u: ToolUnit) => (
              <Space size={4}>
                <Button
                  size="small"
                  icon={<QrcodeOutlined />}
                  onClick={() => setQrUnit(u)}
                >
                  QR
                </Button>
                {canEdit && (
                <Dropdown
                  menu={{
                    items: [
                      u.status !== 'AVAILABLE'
                        ? {
                            key: 'avail',
                            label: 'Mark available',
                            onClick: () => void setUnitStatus(u, 'AVAILABLE'),
                          }
                        : null,
                      u.status !== 'UNDER_REPAIR'
                        ? {
                            key: 'repair',
                            label: 'Under repair',
                            onClick: () => void setUnitStatus(u, 'UNDER_REPAIR'),
                          }
                        : null,
                      u.status !== 'RETIRED'
                        ? {
                            key: 'retire',
                            label: 'Retire',
                            onClick: () => void setUnitStatus(u, 'RETIRED'),
                          }
                        : null,
                    ].filter(Boolean) as MenuProps['items'],
                  }}
                  trigger={['click']}
                >
                  <Button size="small" type="text" icon={<MoreOutlined />} />
                </Dropdown>
                )}
              </Space>
            ),
          },
        ]}
      />
    );
  };

  return (
    <div>
      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            placeholder="Search tool type…"
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="std-list-search"
          />
          <Select
            className="std-list-filter std-list-filter--sm"
            value={onlyOut ? 'out' : 'all'}
            onChange={(v) => setOnlyOut(v === 'out')}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'out', label: 'With units out' },
            ]}
          />
        </div>
        <div className="std-list-actions">
          {types.some((t) => t.isSeed) && (
            <InfoTip
              title="Seed placeholder tools"
              label="About seed tools"
              content="Types marked seed are temporary until the client provides the real asset list."
            />
          )}
          <Button icon={<SwapOutlined />} onClick={() => setHistoryOpen(true)}>
            Borrow history
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => setEventsOpen(true)}>
            Event log
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() =>
              exportCsv('tool-types.csv', filtered, [
                { key: 'name', header: 'Name', value: (r: ToolType) => r.name },
                { key: 'code', header: 'Code', value: (r: ToolType) => r.code },
                { key: 'total', header: 'Total', value: (r: ToolType) => r.totalUnits },
                { key: 'avail', header: 'Available', value: (r: ToolType) => r.availableCount },
                { key: 'out', header: 'Out', value: (r: ToolType) => r.outCount },
              ])
            }
          >
            Export CSV
          </Button>
          {canEdit && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ fontWeight: 700 }}
              onClick={() => setTypeModal(true)}
            >
              Add tool type
            </Button>
          )}
        </div>
      </div>

      <Table
        className="std-list-table"
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpand,
          expandedRowRender,
        }}
        locale={{
          emptyText: onlyOut
            ? 'No tool types currently have units out with workers.'
            : 'No tool types yet. Add a type, then add individual units with QR codes.',
        }}
        pagination={false}
      />

      <Drawer
        title="Borrow and return history"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={720}
        destroyOnHidden
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <DatePicker.RangePicker
            value={usageRange}
            allowClear={false}
            onChange={(vals) => {
              if (vals?.[0] && vals?.[1]) {
                setUsageRange([vals[0].startOf('day'), vals[1].endOf('day')]);
              }
            }}
          />
          <Button type="primary" loading={usageLoading} onClick={() => void fetchUsage()}>
            Refresh
          </Button>
        </Space>
        <Table
          className="std-list-table"
          size="small"
          rowKey={(r) => `${r.workerId}-${r.toolId}`}
          loading={usageLoading}
          dataSource={usage?.byWorkerItem || []}
          locale={{
            emptyText:
              'No borrow or return activity in this period. Workers scan a unit QR to create history.',
          }}
          columns={[
            { title: 'Worker', dataIndex: 'workerName' },
            {
              title: 'Unit',
              render: (_: unknown, r) =>
                [r.toolName, r.toolCode || r.assetCode].filter(Boolean).join(' · '),
            },
            { title: 'Borrowed', dataIndex: 'borrowQuantity', align: 'right', width: 90 },
            { title: 'Returned', dataIndex: 'returnQuantity', align: 'right', width: 90 },
          ]}
        />
      </Drawer>

      <Drawer
        title="Tool event log"
        open={eventsOpen}
        onClose={() => setEventsOpen(false)}
        width={720}
        destroyOnHidden
      >
        <ToolEventsPage category="TOOL" />
      </Drawer>

      <Modal
        open={typeModal}
        onCancel={() => setTypeModal(false)}
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
            <AppstoreAddOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">Add tool type</div>
            <div className="app-form-modal__sub">
              Individually tracked tools — add units with QR codes after creating the type.
            </div>
          </div>
          <button
            type="button"
            className="app-form-modal__close"
            onClick={() => setTypeModal(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <Form
          form={typeForm}
          layout="vertical"
          onFinish={createType}
          style={{ padding: '20px 24px 8px' }}
        >
          {sectionLabel('Type details')}
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input placeholder="e.g. Angle grinder" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="Type code" style={{ marginBottom: 14 }}>
                <Input placeholder="Auto-generated if empty" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="Description" style={{ marginBottom: 14 }}>
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <div className="app-form-modal__footer">
          <Button onClick={() => setTypeModal(false)} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={creatingType}
            onClick={() => typeForm.submit()}
            style={{ fontWeight: 700, minWidth: 120 }}
          >
            Create
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(unitModalType)}
        onCancel={() => setUnitModalType(null)}
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
            <AppstoreAddOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">Add unit</div>
            <div className="app-form-modal__sub">
              {unitModalType
                ? `${unitModalType.name} — each unit gets its own asset code and QR.`
                : 'Each unit gets its own asset code and QR.'}
            </div>
          </div>
          <button
            type="button"
            className="app-form-modal__close"
            onClick={() => setUnitModalType(null)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <Form
          form={unitForm}
          layout="vertical"
          onFinish={createUnit}
          style={{ padding: '20px 24px 8px' }}
        >
          {sectionLabel('Unit details')}
          <Form.Item name="assetCode" label="Asset code" style={{ marginBottom: 14 }}>
            <Input placeholder="Auto-generated if empty (e.g. TYPE-001)" />
          </Form.Item>
          <Form.Item name="notes" label="Notes" style={{ marginBottom: 14 }}>
            <Input placeholder="Optional" />
          </Form.Item>
        </Form>
        <div className="app-form-modal__footer">
          <Button onClick={() => setUnitModalType(null)} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={creatingUnit}
            onClick={() => unitForm.submit()}
            style={{ fontWeight: 700, minWidth: 120 }}
          >
            Create
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(receiveType)}
        onCancel={() => setReceiveType(null)}
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
            <AppstoreAddOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">
              {receiveType ? `Receive delivery: ${receiveType.name}` : 'Receive delivery'}
            </div>
            <div className="app-form-modal__sub">
              Creates available units with asset codes and logs a RECEIVE event each.
            </div>
          </div>
          <button
            type="button"
            className="app-form-modal__close"
            onClick={() => setReceiveType(null)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <Form
          form={receiveForm}
          layout="vertical"
          onFinish={onReceiveUnits}
          style={{ padding: '20px 24px 8px' }}
          initialValues={{ receivedOn: shopToday(), quantity: 1 }}
        >
          {sectionLabel('Delivery')}
          <Form.Item
            name="quantity"
            label="Quantity (units)"
            rules={[{ required: true }]}
            style={{ marginBottom: 14 }}
          >
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="supplier"
            label="Supplier"
            rules={[{ required: true, message: 'Supplier is required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input placeholder="Supplier name" />
          </Form.Item>
          <Form.Item
            name="receivedOn"
            label="Date received"
            rules={[{ required: true }]}
            style={{ marginBottom: 14 }}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear={false} />
          </Form.Item>
          <Form.Item name="note" label="Note (optional)" style={{ marginBottom: 14 }}>
            <Input.TextArea rows={2} placeholder="PO number, invoice, etc." />
          </Form.Item>
        </Form>
        <div className="app-form-modal__footer">
          <Button onClick={() => setReceiveType(null)} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={receiving}
            onClick={() => receiveForm.submit()}
            style={{ fontWeight: 700, minWidth: 140 }}
          >
            Receive delivery
          </Button>
        </div>
      </Modal>

      <Modal
        title={qrUnit ? `QR: ${qrUnit.assetCode}` : 'QR'}
        open={Boolean(qrUnit)}
        onCancel={() => setQrUnit(null)}
        footer={null}
      >
        {qrUnit && <UnitQrImage unitId={qrUnit.id} code={qrUnit.assetCode} />}
      </Modal>
    </div>
  );
}

function UnitQrImage({ unitId, code }: { unitId: string; code: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    apiClient
      .get(`/tools/units/${unitId}/qr`, { responseType: 'blob' })
      .then(({ data }) => setSrc(URL.createObjectURL(data)));
  }, [unitId]);
  return (
    <div style={{ textAlign: 'center' }}>
      {src && <img src={src} alt={`QR ${code}`} style={{ maxWidth: '100%' }} />}
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {code}
      </Typography.Text>
    </div>
  );
}
