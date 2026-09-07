import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  Select,
  Segmented,
  DatePicker,
  Alert,
  Dropdown,
  Drawer,
  Row,
  Col,
  Spin,
  message,
  Tooltip,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DownloadOutlined,
  MoreOutlined,
  AppstoreAddOutlined,
  HistoryOutlined,
  EditOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import StatusPill from '../../components/StatusPill';
import SelectMultipleIcon from '../../components/SelectMultipleIcon';
import InfoTip from '../../components/InfoTip';
import type { InventoryUsageConsumables, Tool } from '../../types';
import { getErrorMessage } from '../../api/client';
import { useIsPhone } from '../../hooks/useIsPhone';
import { exportCsv } from '../../utils/csvExport';
import StocktakePanel from './StocktakePanel';
import ToolEventsPage from './ToolEventsPage';
import ToolsAssetsPanel from './ToolsAssetsPanel';

type PageTab = 'tools' | 'consumables';
type StockFilter = 'low' | 'ok';
type CountsDrawerTab = 'stocktake' | 'consumption';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

export default function ToolsPage() {
  const [tab, setTab] = useState<PageTab>('tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTool, setEditTool] = useState<Tool | null>(null);
  const [adjustTool, setAdjustTool] = useState<Tool | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
  const [countsTab, setCountsTab] = useState<CountsDrawerTab>('stocktake');
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [adjustForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const isPhone = useIsPhone();

  const [usageConsumables, setUsageConsumables] = useState<InventoryUsageConsumables | null>(
    null
  );
  const [usageRange, setUsageRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [usageLoading, setUsageLoading] = useState(false);

  const fetchTools = async () => {
    setLoading(true);
    try {
      const { data } = await toolsApi.list({ category: 'CONSUMABLE' });
      setTools(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchUsage = async () => {
    setUsageLoading(true);
    try {
      const c = await inventoryApi.usageConsumables({
        from: usageRange[0].format('YYYY-MM-DD'),
        to: usageRange[1].format('YYYY-MM-DD'),
      });
      setUsageConsumables(c.data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'consumables') {
      void fetchTools();
    }
  }, [tab]);

  useEffect(() => {
    if (countsOpen && countsTab === 'consumption') {
      void fetchUsage();
    }
  }, [countsOpen, countsTab]);

  useEffect(() => {
    if (editTool) {
      editForm.setFieldsValue({
        name: editTool.name,
        code: editTool.code,
        unit: editTool.unit,
        sizeSpec: editTool.sizeSpec,
        minimumStock: editTool.minimumStock,
      });
    }
  }, [editTool, editForm]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (q && !`${t.name} ${t.code} ${t.sizeSpec || ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (stockFilter.length) {
        const ok = !t.lowStock;
        const match = stockFilter.some((f) => (f === 'low' ? t.lowStock : ok));
        if (!match) return false;
      }
      return true;
    });
  }, [tools, query, stockFilter]);

  const lowCount = tools.filter((t) => t.lowStock).length;

  const onCreate = async (values: {
    name: string;
    code?: string;
    unit: string;
    quantityOnHand: number;
    minimumStock?: number | null;
    sizeSpec?: string;
  }) => {
    try {
      setCreating(true);
      await toolsApi.create({ ...values, category: 'CONSUMABLE' });
      message.success('Consumable added');
      setModalOpen(false);
      form.resetFields();
      await fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const onEdit = async (values: {
    name: string;
    code: string;
    unit: string;
    minimumStock?: number | null;
    sizeSpec?: string;
  }) => {
    if (!editTool) return;
    try {
      setSavingEdit(true);
      await toolsApi.update(editTool.id, values);
      message.success('Item updated');
      setEditTool(null);
      await fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const onAdjust = async (values: { quantity: number; reason: string }) => {
    if (!adjustTool) return;
    try {
      await toolsApi.adjust(adjustTool.id, values);
      message.success('Stock adjusted');
      setAdjustTool(null);
      adjustForm.resetFields();
      await fetchTools();
      void fetchUsage();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const actionItems = (record: Tool): MenuProps['items'] => [
    { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => setEditTool(record) },
    { key: 'adjust', label: 'Adjust stock', onClick: () => setAdjustTool(record) },
  ];

  const columns: TableColumnsType<Tool> = [
    {
      title: 'Item',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{r.name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{r.code}</div>
        </div>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'sizeSpec',
      width: 100,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'In stock',
      key: 'stock',
      width: 110,
      sorter: (a, b) => (a.quantityOnHand ?? 0) - (b.quantityOnHand ?? 0),
      render: (_: unknown, r) => (
        <span style={{ fontWeight: r.lowStock ? 700 : 500, color: r.lowStock ? '#b45309' : '#475569' }}>
          {r.quantityOnHand} {r.unit}
        </span>
      ),
    },
    {
      title: 'Reorder level',
      dataIndex: 'minimumStock',
      width: 120,
      render: (v: number | null, r) => (v == null ? '—' : `${v} ${r.unit}`),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: unknown, r) =>
        r.lowStock ? (
          <StatusPill color="amber" compact>Low stock</StatusPill>
        ) : (
          <StatusPill color="green" compact>OK</StatusPill>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      render: (_: unknown, record) => (
        <Dropdown menu={{ items: actionItems(record) }} trigger={['click']}>
          <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} />
        </Dropdown>
      ),
    },
  ];

  const stockCsvFields = [
    { key: 'name', header: 'Name', value: (r: Tool) => r.name },
    { key: 'code', header: 'Code', value: (r: Tool) => r.code },
    { key: 'size', header: 'Size', value: (r: Tool) => r.sizeSpec },
    { key: 'unit', header: 'Unit', value: (r: Tool) => r.unit },
    { key: 'onHand', header: 'QuantityOnHand', value: (r: Tool) => r.quantityOnHand },
    { key: 'min', header: 'MinimumStock', value: (r: Tool) => r.minimumStock },
    { key: 'low', header: 'LowStock', value: (r: Tool) => (r.lowStock ? 'yes' : 'no') },
  ];

  const stockEmpty =
    tools.length === 0
      ? 'No consumables in the catalog yet. Add items, then use stocktake to count the shelf.'
      : stockFilter.includes('low') && !stockFilter.includes('ok') && lowCount === 0
        ? 'No items are at or below reorder level right now.'
        : 'No items match your search or stock filter.';

  return (
    <div>
      <div className="admin-h-scroll">
        <Segmented
          style={{ marginBottom: 16 }}
          value={tab}
          onChange={(v) => setTab(v as PageTab)}
          options={[
            { label: 'Tools', value: 'tools' },
            { label: 'Consumables', value: 'consumables' },
          ]}
        />
      </div>

      {tab === 'tools' && <ToolsAssetsPanel />}

      {tab === 'consumables' && (
        <>
          <div className="std-list-page">
            <div className="std-list-toolbar">
              <div className="std-list-filters">
                <Input
                  allowClear
                  placeholder="Search item, code, size…"
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="std-list-search"
                />
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Stock"
                  className="std-list-filter std-list-filter--sm"
                  value={stockFilter}
                  onChange={setStockFilter}
                  options={[
                    { value: 'low', label: lowCount ? `Low stock (${lowCount})` : 'Low stock' },
                    { value: 'ok', label: 'OK' },
                  ]}
                />
              </div>
              <div className="std-list-actions">
                <Tooltip title={selectMode ? 'Done selecting' : 'Select multiple'}>
                  <Button
                    icon={<SelectMultipleIcon />}
                    type={selectMode ? 'primary' : 'default'}
                    ghost={selectMode}
                    onClick={() => {
                      if (selectMode) {
                        setSelectMode(false);
                        setSelectedKeys([]);
                      } else setSelectMode(true);
                    }}
                  />
                </Tooltip>
                <Button icon={<AuditOutlined />} onClick={() => setCountsOpen(true)}>
                  Stocktake
                </Button>
                <Button icon={<HistoryOutlined />} onClick={() => setEventsOpen(true)}>
                  Event log
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => exportCsv('consumables-stock.csv', filtered, stockCsvFields)}
                >
                  Export CSV
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setModalOpen(true)}
                  style={{ fontWeight: 700 }}
                >
                  Add consumable
                </Button>
              </div>
            </div>

            {lowCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`${lowCount} item${lowCount === 1 ? '' : 's'} at or below reorder level`}
                action={
                  <Button size="small" onClick={() => setStockFilter(['low'])}>
                    Show low stock only
                  </Button>
                }
              />
            )}

            {isPhone ? (
              <div className="admin-cards">
                {loading && (
                  <div className="page-spinner">
                    <Spin />
                  </div>
                )}
                {!loading && filtered.length === 0 && (
                  <div className="admin-cards__empty">{stockEmpty}</div>
                )}
                {!loading &&
                  filtered.map((r) => (
                    <div key={r.id} className="admin-card">
                      <div className="admin-card__top">
                        <div>
                          <div className="admin-card__title">{r.name}</div>
                          <div className="admin-card__meta">
                            {[r.sizeSpec, r.code].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <Dropdown menu={{ items: actionItems(r) }} trigger={['click']}>
                          <Button type="text" size="small" icon={<MoreOutlined />} />
                        </Dropdown>
                      </div>
                      <div className="admin-card__row">
                        <span style={{ fontWeight: r.lowStock ? 800 : 600 }}>
                          {r.quantityOnHand} {r.unit}
                        </span>
                        {r.lowStock ? (
                          <StatusPill color="amber" compact>Low stock</StatusPill>
                        ) : (
                          <StatusPill color="green" compact>OK</StatusPill>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <Table
                className="std-list-table"
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={filtered}
                loading={loading}
                rowClassName={(r) => (r.lowStock ? 'inventory-low-stock' : '')}
                locale={{ emptyText: stockEmpty }}
                scroll={{ x: 820 }}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                rowSelection={
                  selectMode
                    ? {
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys.map(String)),
                      }
                    : undefined
                }
              />
            )}
          </div>

          <Drawer
            title="Stocktake & consumption"
            open={countsOpen}
            onClose={() => setCountsOpen(false)}
            width={isPhone ? '100%' : 880}
            destroyOnHidden
          >
            <Segmented
              style={{ marginBottom: 16 }}
              value={countsTab}
              onChange={(v) => setCountsTab(v as CountsDrawerTab)}
              options={[
                { label: 'Stocktake', value: 'stocktake' },
                { label: 'Consumption', value: 'consumption' },
              ]}
            />
            {countsTab === 'stocktake' && (
              <StocktakePanel
                hideTitle
                onSaved={() => {
                  void fetchTools();
                  void fetchUsage();
                }}
              />
            )}
            {countsTab === 'consumption' && (
              <>
                <Space style={{ marginBottom: 12 }} wrap align="center">
                  <InfoTip
                    title="Consumption"
                    content="Usage is measured between stocktakes, not per person."
                    label="About consumption"
                  />
                  <DatePicker.RangePicker
                    value={usageRange}
                    allowClear={false}
                    onChange={(vals) => {
                      if (vals?.[0] && vals?.[1]) {
                        setUsageRange([vals[0].startOf('day'), vals[1].endOf('day')]);
                      }
                    }}
                  />
                  <Button type="primary" onClick={() => void fetchUsage()} loading={usageLoading}>
                    Refresh
                  </Button>
                </Space>
                <Table
                  className="std-list-table"
                  size="small"
                  rowKey="toolId"
                  loading={usageLoading}
                  dataSource={usageConsumables?.items || []}
                  locale={{
                    emptyText:
                      'No stocktake yet. Count the shelf to start tracking consumption between counts.',
                  }}
                  columns={[
                    {
                      title: 'Item',
                      render: (_: unknown, r) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.name}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {[r.sizeSpec, r.code].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Consumed',
                      dataIndex: 'consumptionQuantity',
                      align: 'right',
                      render: (v: number, r) => `${v ?? 0} ${r.unit}`,
                    },
                    {
                      title: 'Per working day',
                      dataIndex: 'consumptionPerWorkingDay',
                      align: 'right',
                      render: (v: number | null) => (v == null ? '—' : v.toFixed(3)),
                    },
                    {
                      title: 'In stock',
                      dataIndex: 'quantityOnHand',
                      align: 'right',
                      render: (v: number, r) => `${v} ${r.unit}`,
                    },
                  ]}
                />
              </>
            )}
          </Drawer>

          <Drawer
            title="Consumable event log"
            open={eventsOpen}
            onClose={() => setEventsOpen(false)}
            width={isPhone ? '100%' : 720}
            destroyOnHidden
          >
            <ToolEventsPage category="CONSUMABLE" />
          </Drawer>

          <Modal
            open={modalOpen}
            onCancel={() => setModalOpen(false)}
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
              <div style={{ flex: 1 }}>
                <div className="app-form-modal__title">Add consumable</div>
                <div className="app-form-modal__sub">Tracked with periodic stocktake counts.</div>
              </div>
              <button type="button" className="app-form-modal__close" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </div>
            <Form
              form={form}
              layout="vertical"
              onFinish={onCreate}
              style={{ padding: '20px 24px 8px' }}
              initialValues={{ unit: 'pcs', quantityOnHand: 0 }}
            >
              {sectionLabel('Item details')}
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input placeholder="e.g. Cutting disc" />
              </Form.Item>
              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item name="code" label="Code">
                    <Input placeholder="Auto-generated if empty" />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item name="sizeSpec" label="Size / spec">
                    <Input placeholder="e.g. 10mm" />
                  </Form.Item>
                </Col>
              </Row>
              {sectionLabel('Stock levels')}
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="unit" label="Unit" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="quantityOnHand" label="In stock" rules={[{ required: true }]}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="minimumStock" label="Reorder level">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <div className="app-form-modal__footer">
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" loading={creating} onClick={() => form.submit()} style={{ fontWeight: 700 }}>
                Create
              </Button>
            </div>
          </Modal>

          <Modal title={editTool ? `Edit: ${editTool.name}` : 'Edit'} open={Boolean(editTool)} onCancel={() => setEditTool(null)} footer={null} destroyOnHidden>
            <Form form={editForm} layout="vertical" onFinish={onEdit}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="sizeSpec" label="Size / spec">
                <Input />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="unit" label="Unit" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="minimumStock" label="Reorder level">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Button type="primary" htmlType="submit" block loading={savingEdit}>
                Save changes
              </Button>
            </Form>
          </Modal>

          <Modal title={adjustTool ? `Adjust stock: ${adjustTool.name}` : 'Adjust'} open={Boolean(adjustTool)} onCancel={() => setAdjustTool(null)} footer={null}>
            <Form form={adjustForm} layout="vertical" onFinish={onAdjust}>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Use a positive quantity for deliveries so stocktakes do not treat them as consumption." />
              <Form.Item name="quantity" label="Quantity change (+ add / − remove)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Button type="primary" htmlType="submit" block>
                Save adjustment
              </Button>
            </Form>
          </Modal>
        </>
      )}
    </div>
  );
}
