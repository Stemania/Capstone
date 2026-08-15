import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Typography,
  Space,
  Select,
  Segmented,
  DatePicker,
  Alert,
  Dropdown,
  message,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DownloadOutlined,
  CheckSquareOutlined,
  MoreOutlined,
  QrcodeOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import StatusPill from '../../components/StatusPill';
import type {
  InventoryPurchaseSuggestions,
  InventoryUsageByItem,
  InventoryUsageByWorker,
  Tool,
  ToolCategory,
} from '../../types';
import apiClient, { getErrorMessage } from '../../api/client';
import { exportCsv } from '../../utils/csvExport';

type StockFilter = 'low' | 'ok';
type PageTab = 'stock' | 'suggestions' | 'usage';

export default function ToolsPage() {
  const [tab, setTab] = useState<PageTab>('stock');
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [adjustTool, setAdjustTool] = useState<Tool | null>(null);
  const [qrTool, setQrTool] = useState<Tool | null>(null);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<ToolCategory[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [adjustForm] = Form.useForm();

  const [suggestions, setSuggestions] = useState<InventoryPurchaseSuggestions | null>(null);
  const [usageWorker, setUsageWorker] = useState<InventoryUsageByWorker | null>(null);
  const [usageItem, setUsageItem] = useState<InventoryUsageByItem | null>(null);
  const [usageRange, setUsageRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [usageLoading, setUsageLoading] = useState(false);

  const fetchTools = async () => {
    setLoading(true);
    try {
      const { data } = await toolsApi.list();
      setTools(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const { data } = await inventoryApi.purchaseSuggestions({ lookbackDays: 30 });
      setSuggestions(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const fetchUsage = async () => {
    setUsageLoading(true);
    try {
      const params = {
        from: usageRange[0].format('YYYY-MM-DD'),
        to: usageRange[1].format('YYYY-MM-DD'),
      };
      const [w, i] = await Promise.all([
        inventoryApi.usageByWorker(params),
        inventoryApi.usageByItem(params),
      ]);
      setUsageWorker(w.data);
      setUsageItem(i.data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  useEffect(() => {
    if (tab === 'suggestions') void fetchSuggestions();
    if (tab === 'usage') void fetchUsage();
  }, [tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (q && !`${t.name} ${t.code} ${t.sizeSpec || ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (categoryFilter.length && !categoryFilter.includes(t.category)) return false;
      if (stockFilter.length) {
        const ok = !t.lowStock;
        const match = stockFilter.some((f) => (f === 'low' ? t.lowStock : ok));
        if (!match) return false;
      }
      return true;
    });
  }, [tools, query, stockFilter, categoryFilter]);

  const selectedTools = useMemo(
    () => filtered.filter((t) => selectedKeys.includes(t.id)),
    [filtered, selectedKeys]
  );

  const onCreate = async (values: {
    name: string;
    code?: string;
    category: ToolCategory;
    unit: string;
    quantityOnHand: number;
    minimumStock?: number | null;
    sizeSpec?: string;
  }) => {
    await toolsApi.create(values);
    setModalOpen(false);
    form.resetFields();
    fetchTools();
  };

  const onAdjust = async (values: { quantity: number; reason: string }) => {
    if (!adjustTool) return;
    try {
      await toolsApi.adjust(adjustTool.id, values);
      message.success('Stock adjusted');
      setAdjustTool(null);
      adjustForm.resetFields();
      fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const columns: TableColumnsType<Tool> = [
    {
      title: 'Item',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{r.name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {[r.sizeSpec, r.code].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      width: 130,
      render: (c: ToolCategory) =>
        c === 'CONSUMABLE' ? (
          <StatusPill color="gray" compact>Consumable</StatusPill>
        ) : (
          <StatusPill color="blue" compact>Returnable</StatusPill>
        ),
    },
    {
      title: 'In stock',
      key: 'stock',
      width: 120,
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
      width: 130,
      sorter: (a, b) => (a.minimumStock ?? 0) - (b.minimumStock ?? 0),
      render: (v: number | null, r) => (v == null ? '—' : `${v} ${r.unit}`),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_: unknown, r) =>
        r.lowStock ? (
          <StatusPill color="amber" compact>Low stock</StatusPill>
        ) : (
          <StatusPill color="green" compact>OK</StatusPill>
        ),
    },
    {
      title: 'Holders',
      key: 'holders',
      width: 140,
      render: (_: unknown, r) => {
        if (r.category === 'CONSUMABLE') return '—';
        const n = r.holders?.length ?? 0;
        if (!n) return <span style={{ color: '#94a3b8' }}>None out</span>;
        return (
          <span>
            {n} worker{n === 1 ? '' : 's'}
          </span>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      align: 'center',
      render: (_: unknown, record) => {
        const items: MenuProps['items'] = [
          {
            key: 'qr',
            icon: <QrcodeOutlined />,
            label: 'QR',
            onClick: () => setQrTool(record),
          },
          {
            key: 'adjust',
            label: 'Adjust stock',
            onClick: () => setAdjustTool(record),
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined style={{ fontSize: 18 }} />}
              aria-label="More actions"
            />
          </Dropdown>
        );
      },
    },
  ];

  const stockCsvFields = [
    { key: 'name', header: 'Name', value: (r: Tool) => r.name },
    { key: 'code', header: 'Code', value: (r: Tool) => r.code },
    { key: 'category', header: 'Category', value: (r: Tool) => r.category },
    { key: 'unit', header: 'Unit', value: (r: Tool) => r.unit },
    { key: 'onHand', header: 'QuantityOnHand', value: (r: Tool) => r.quantityOnHand },
    { key: 'min', header: 'MinimumStock', value: (r: Tool) => r.minimumStock },
    { key: 'low', header: 'LowStock', value: (r: Tool) => (r.lowStock ? 'yes' : 'no') },
  ];

  return (
    <div>
      <Segmented
        style={{ marginBottom: 16 }}
        value={tab}
        onChange={(v) => setTab(v as PageTab)}
        options={[
          { label: 'Stock', value: 'stock' },
          { label: 'Items to buy', value: 'suggestions' },
          { label: 'Usage', value: 'usage' },
        ]}
      />

      {tab === 'stock' && (
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
                placeholder="Category"
                className="std-list-filter std-list-filter--sm"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: 'RETURNABLE_TOOL', label: 'Returnable' },
                  { value: 'CONSUMABLE', label: 'Consumable' },
                ]}
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
                  { value: 'low', label: 'Low stock' },
                  { value: 'ok', label: 'OK' },
                ]}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                icon={<CheckSquareOutlined />}
                type={selectMode ? 'primary' : 'default'}
                ghost={selectMode}
                onClick={() => {
                  if (selectMode) {
                    setSelectMode(false);
                    setSelectedKeys([]);
                  } else {
                    setSelectMode(true);
                  }
                }}
              >
                {selectMode ? 'Done selecting' : 'Select multiple'}
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  exportCsv('inventory-stock.csv', filtered, stockCsvFields)
                }
              >
                Export CSV
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setModalOpen(true)}
                style={{ fontWeight: 700 }}
              >
                Add item
              </Button>
            </div>
          </div>

          {selectMode && (
            <div className="std-list-bulk">
              <span className="std-list-bulk__count">
                {selectedKeys.length
                  ? `${selectedKeys.length} selected`
                  : 'Select items to export'}
              </span>
              <Space size={8}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={!selectedTools.length}
                  onClick={() => exportCsv('inventory-stock.csv', selectedTools, stockCsvFields)}
                >
                  Export selected
                </Button>
                {selectedKeys.length > 0 && (
                  <Button size="small" type="text" onClick={() => setSelectedKeys([])}>
                    Clear
                  </Button>
                )}
              </Space>
            </div>
          )}

          <Table
            className="std-list-table"
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            rowClassName={(r) => (r.lowStock ? 'inventory-low-stock' : '')}
            locale={{ emptyText: 'No inventory items match your filters yet' }}
            scroll={{ x: 960 }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `${total} item${total === 1 ? '' : 's'}`,
            }}
            rowSelection={
              selectMode
                ? {
                    selectedRowKeys: selectedKeys,
                    onChange: (keys) => setSelectedKeys(keys.map(String)),
                    preserveSelectedRowKeys: true,
                  }
                : undefined
            }
          />
        </div>
      )}

      {tab === 'suggestions' && (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Suggestions for Office to review — nothing is ordered automatically"
            description={suggestions?.description}
          />
          <Table
            className="std-list-table"
            size="small"
            rowKey="toolId"
            loading={!suggestions}
            dataSource={suggestions?.items || []}
            locale={{ emptyText: 'No items are at or below reorder level right now' }}
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
                title: 'In stock',
                dataIndex: 'quantityOnHand',
                align: 'right',
                render: (v: number, r) => `${v} ${r.unit}`,
              },
              {
                title: 'Reorder level',
                dataIndex: 'minimumStock',
                align: 'right',
                render: (v: number, r) => `${v} ${r.unit}`,
              },
              {
                title: 'Suggested order',
                dataIndex: 'suggestedOrderQuantity',
                align: 'right',
                render: (v: number, r) => (
                  <span style={{ fontWeight: 700 }}>{v} {r.unit}</span>
                ),
              },
              {
                title: 'Recent use / day',
                dataIndex: 'consumptionPerWorkingDay',
                align: 'right',
                render: (v: number | null) => (v == null ? '—' : v.toFixed(2)),
              },
            ]}
          />
        </div>
      )}

      {tab === 'usage' && (
        <div>
          <Space style={{ marginBottom: 16 }} wrap>
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

          <Typography.Title level={5} style={{ color: '#0f1c2e' }}>
            Outstanding unreturned tools
          </Typography.Title>
          <Table
            className="std-list-table"
            size="small"
            style={{ marginBottom: 24 }}
            rowKey="workerId"
            loading={usageLoading}
            dataSource={usageWorker?.outstandingUnreturned || []}
            locale={{ emptyText: 'No returnable tools still out with workers' }}
            columns={[
              { title: 'Worker', dataIndex: 'workerName' },
              {
                title: 'Total outstanding',
                dataIndex: 'totalOutstandingQuantity',
                align: 'right',
              },
              {
                title: 'Items',
                render: (_: unknown, r) =>
                  r.items.map((i) => `${i.toolName} (${i.quantity})`).join(', '),
              },
            ]}
          />

          <Typography.Title level={5} style={{ color: '#0f1c2e' }}>
            Usage by worker × item
          </Typography.Title>
          <Table
            className="std-list-table"
            size="small"
            style={{ marginBottom: 24 }}
            rowKey={(r) => `${r.workerId}-${r.toolId}`}
            loading={usageLoading}
            dataSource={usageWorker?.byWorkerItem || []}
            columns={[
              { title: 'Worker', dataIndex: 'workerName' },
              {
                title: 'Item',
                render: (_: unknown, r) =>
                  [r.toolName, r.sizeSpec].filter(Boolean).join(' · '),
              },
              { title: 'Issued', dataIndex: 'issueQuantity', align: 'right', width: 80 },
              { title: 'Borrowed', dataIndex: 'borrowQuantity', align: 'right', width: 90 },
              { title: 'Returned', dataIndex: 'returnQuantity', align: 'right', width: 90 },
              {
                title: 'Net take',
                dataIndex: 'netConsumptionQuantity',
                align: 'right',
                width: 90,
                render: (v: number) => <span style={{ fontWeight: 700 }}>{v}</span>,
              },
            ]}
          />

          <Typography.Title level={5} style={{ color: '#0f1c2e' }}>
            Consumption by item
          </Typography.Title>
          <Table
            className="std-list-table"
            size="small"
            rowKey="toolId"
            loading={usageLoading}
            dataSource={usageItem?.items || []}
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
                render: (v: number, r) => `${v} ${r.unit}`,
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
                render: (v: number, r) => (
                  <span style={{ color: r.lowStock ? '#b45309' : undefined, fontWeight: r.lowStock ? 700 : 400 }}>
                    {v} {r.unit}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <Modal title="Add inventory item" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onCreate}
          initialValues={{ category: 'RETURNABLE_TOOL', unit: 'pcs', quantityOnHand: 0 }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code (optional)">
            <Input placeholder="Auto-generated if empty" />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'RETURNABLE_TOOL', label: 'Returnable tool' },
                { value: 'CONSUMABLE', label: 'Consumable' },
              ]}
            />
          </Form.Item>
          <Form.Item name="sizeSpec" label="Size / spec">
            <Input placeholder="e.g. 10mm" />
          </Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="unit" label="Unit" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="pcs" />
            </Form.Item>
            <Form.Item
              name="quantityOnHand"
              label="In stock"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="minimumStock" label="Reorder level" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      <Modal
        title={adjustTool ? `Adjust stock: ${adjustTool.name}` : 'Adjust'}
        open={Boolean(adjustTool)}
        onCancel={() => setAdjustTool(null)}
        footer={null}
      >
        <Form form={adjustForm} layout="vertical" onFinish={onAdjust}>
          <Form.Item
            name="quantity"
            label="Quantity change (+ add / − remove)"
            rules={[{ required: true }]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="Required — why you’re changing the count" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Save adjustment
          </Button>
        </Form>
      </Modal>

      <Modal
        title={qrTool ? `QR: ${qrTool.name}` : 'QR Code'}
        open={Boolean(qrTool)}
        onCancel={() => setQrTool(null)}
        footer={null}
      >
        {qrTool && (
          <div style={{ textAlign: 'center' }}>
            <AuthenticatedQrImage toolId={qrTool.id} code={qrTool.code} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function AuthenticatedQrImage({ toolId, code }: { toolId: string; code: string }) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    apiClient
      .get(`/tools/${toolId}/qr`, { responseType: 'blob' })
      .then(({ data }) => setSrc(URL.createObjectURL(data)));
  }, [toolId]);

  return (
    <div>
      {src && <img src={src} alt={`QR for ${code}`} style={{ maxWidth: '100%' }} />}
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {code}
      </Typography.Text>
    </div>
  );
}
