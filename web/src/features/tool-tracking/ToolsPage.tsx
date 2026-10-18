import { shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Form, Input, InputNumber, Select, Segmented, DatePicker, Alert, Dropdown, Drawer, Row, Col, message, Tooltip } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  SearchOutlined,
  DownloadOutlined,
  MoreOutlined,
  AppstoreAddOutlined,
  HistoryOutlined,
  EditOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { BookOpen, Layers, Package, PackageOpen, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Dayjs } from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import SelectMultipleIcon from '../../components/SelectMultipleIcon';
import type { Tool } from '../../types';
import { getErrorMessage } from '../../api/client';
import { useIsPhone } from '../../hooks/useIsPhone';
import { exportCsv } from '../../utils/csvExport';
import StocktakePanel from './StocktakePanel';
import { useAuth } from '../../hooks/useAuth';
import ToolEventsPage from './ToolEventsPage';
import ToolsAssetsPanel from './ToolsAssetsPanel';
import RawMaterialsPanel from './RawMaterialsPanel';
import MaterialCatalogPanel from './MaterialCatalogPanel';
import ResponsiveTable from '../../components/ui/ResponsiveTable';
import { INVENTORY_TAB_OPTIONS } from './inventoryTabs';
import {
  CategoryTile,
  InventoryEmptyState,
  InventorySummaryCards,
  StockBar,
  StockStatusPill,
  consumableStockStatus,
  type InventorySummaryCard,
} from './inventoryLook';

type PageTab = 'tools' | 'consumables' | 'raw-materials' | 'catalog';
type StockFilter = 'low' | 'ok';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

export default function ToolsPage() {
  const { isOfficeStaff, isAdmin } = useAuth();
  const canEdit = isOfficeStaff;
  const canEditCatalog = isOfficeStaff || isAdmin;
  const [tab, setTab] = useState<PageTab>('tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTool, setEditTool] = useState<Tool | null>(null);
  const [adjustTool, setAdjustTool] = useState<Tool | null>(null);
  const [receiveTool, setReceiveTool] = useState<Tool | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter[]>([]);
  const [summaryKey, setSummaryKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editForm] = Form.useForm();
  const [adjustForm] = Form.useForm();
  const [receiveForm] = Form.useForm();
  const [savingEdit, setSavingEdit] = useState(false);
  const isPhone = useIsPhone();

  const fetchTools = async () => {
    setLoading(true);
    try {
      // Consumables tab = what we have (stocked); Catalog holds not-yet-stocked items.
      const { data } = await toolsApi.list({ category: 'CONSUMABLE', stockedOnly: true });
      setTools(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'consumables') {
      void fetchTools();
    }
  }, [tab]);

  useEffect(() => {
    if (editTool) {
      editForm.setFieldsValue({
        name: editTool.name,
        code: editTool.code,
        unit: editTool.unit,
        sizeSpec: editTool.sizeSpec,
        shopTerm: editTool.shopTerm,
        minimumStock: editTool.minimumStock,
      });
    }
  }, [editTool, editForm]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (
        q &&
        !`${t.name} ${t.shopTerm || ''} ${t.code} ${t.sizeSpec || ''}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      const status = consumableStockStatus(t.quantityOnHand, t.minimumStock, t.lowStock);
      if (summaryKey === 'reorder_now' && status !== 'REORDER_NOW') return false;
      if (summaryKey === 'reorder_soon' && status !== 'REORDER_SOON') return false;
      if (summaryKey === 'ok' && status !== 'OK') return false;
      if (summaryKey === 'in_stock' && !(t.quantityOnHand > 0)) return false;
      if (stockFilter.length) {
        const ok = !t.lowStock;
        const match = stockFilter.some((f) => (f === 'low' ? t.lowStock : ok));
        if (!match) return false;
      }
      return true;
    });
  }, [tools, query, stockFilter, summaryKey]);

  const lowCount = tools.filter((t) => t.lowStock).length;
  const consumableCards: InventorySummaryCard[] = useMemo(() => {
    let soon = 0;
    let now = 0;
    let ok = 0;
    let inStock = 0;
    for (const t of tools) {
      if (t.quantityOnHand > 0) inStock += 1;
      const s = consumableStockStatus(t.quantityOnHand, t.minimumStock, t.lowStock);
      if (s === 'REORDER_NOW') now += 1;
      else if (s === 'REORDER_SOON') soon += 1;
      else ok += 1;
    }
    return [
      { key: 'in_stock', label: 'Items in stock', value: inStock, icon: Package, tone: 'slate' },
      {
        key: 'reorder_now',
        label: 'Reorder now',
        value: now,
        icon: Package,
        tone: 'red',
        caption: 'Based on reorder level',
      },
      {
        key: 'reorder_soon',
        label: 'Reorder soon',
        value: soon,
        icon: Package,
        tone: 'amber',
        caption: 'Near reorder level',
      },
      { key: 'ok', label: 'OK', value: ok, icon: Package, tone: 'green', caption: 'Above reorder level' },
    ];
  }, [tools]);

  const tabOptions = useMemo(
    () =>
      INVENTORY_TAB_OPTIONS.map((t) => {
        const Icon =
          t.value === 'tools'
            ? Wrench
            : t.value === 'consumables'
              ? Package
              : t.value === 'raw-materials'
                ? Layers
                : BookOpen;
        return {
          value: t.value,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14} strokeWidth={2} aria-hidden />
              {t.label}
            </span>
          ),
        };
      }),
    []
  );

  const onEdit = async (values: {
    name: string;
    code: string;
    unit: string;
    minimumStock?: number | null;
    sizeSpec?: string;
    shopTerm?: string;
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

  const onAdjust = async (values: { actualCount: number; reason: string }) => {
    if (!adjustTool) return;
    try {
      await toolsApi.correct(adjustTool.id, {
        actualCount: values.actualCount,
        reason: values.reason,
      });
      message.success('Stock corrected');
      setAdjustTool(null);
      adjustForm.resetFields();
      await fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onReceive = async (values: {
    quantity: number;
    supplier: string;
    receivedOn: Dayjs;
    note?: string;
  }) => {
    if (!receiveTool) return;
    try {
      await toolsApi.receive(receiveTool.id, {
        quantity: values.quantity,
        supplier: values.supplier,
        receivedOn: values.receivedOn.format('YYYY-MM-DD'),
        note: values.note,
      });
      message.success('Delivery recorded');
      setReceiveTool(null);
      receiveForm.resetFields();
      await fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const actionItems = (record: Tool): MenuProps['items'] => [
    { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => setEditTool(record) },
    {
      key: 'receive',
      label: 'Receive delivery',
      onClick: () => {
        setReceiveTool(record);
        receiveForm.setFieldsValue({ receivedOn: shopToday(), quantity: 1 });
      },
    },
    {
      key: 'correct',
      label: 'Correct stock',
      onClick: () => {
        setAdjustTool(record);
        adjustForm.setFieldsValue({ actualCount: record.quantityOnHand, reason: undefined });
      },
    },
  ];

  const columns: TableColumnsType<Tool> = [
    {
      title: 'Item',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CategoryTile category={r.name} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
              {r.name}
              {r.shopTerm ? (
                <span style={{ fontWeight: 500, color: '#64748b' }}> “{r.shopTerm}”</span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{r.code}</div>
          </div>
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
      width: 120,
      sorter: (a, b) => (a.quantityOnHand ?? 0) - (b.quantityOnHand ?? 0),
      render: (_: unknown, r) => (
        <div>
          <span style={{ fontWeight: r.lowStock ? 700 : 500, color: r.lowStock ? '#b45309' : '#475569' }}>
            {r.quantityOnHand} {r.unit}
          </span>
          <StockBar onHand={r.quantityOnHand} reorderLevel={r.minimumStock} />
        </div>
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
      width: 130,
      render: (_: unknown, r) => (
        <StockStatusPill
          status={consumableStockStatus(r.quantityOnHand, r.minimumStock, r.lowStock)}
        />
      ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 56,
            render: (_: unknown, record: Tool) => (
              <Dropdown menu={{ items: actionItems(record) }} trigger={['click']}>
                <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} />
              </Dropdown>
            ),
          },
        ]
      : []),
  ];

  const stockCsvFields = [
    { key: 'name', header: 'Name', value: (r: Tool) => r.name },
    { key: 'shopTerm', header: 'ShopTerm', value: (r: Tool) => r.shopTerm },
    { key: 'code', header: 'Code', value: (r: Tool) => r.code },
    { key: 'size', header: 'Size', value: (r: Tool) => r.sizeSpec },
    { key: 'unit', header: 'Unit', value: (r: Tool) => r.unit },
    { key: 'onHand', header: 'QuantityOnHand', value: (r: Tool) => r.quantityOnHand },
    { key: 'min', header: 'MinimumStock', value: (r: Tool) => r.minimumStock },
    { key: 'low', header: 'LowStock', value: (r: Tool) => (r.lowStock ? 'yes' : 'no') },
  ];

  const stockEmpty =
    tools.length === 0
      ? 'Consumables appear here after their first supplier order is received.'
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
          options={tabOptions}
        />
      </div>

      {tab === 'tools' && <ToolsAssetsPanel />}

      {tab === 'raw-materials' && <RawMaterialsPanel />}

      {tab === 'catalog' && <MaterialCatalogPanel canEdit={canEditCatalog} />}

      {tab === 'consumables' && (
        <>
          <div className="std-list-page">
            <InventorySummaryCards
              cards={consumableCards}
              activeKey={summaryKey}
              onSelect={setSummaryKey}
            />
            <div className="std-list-toolbar">
              <div className="std-list-filters">
                <Input
                  allowClear
                  placeholder="Search item, shop term, code, size…"
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
                {isPhone ? (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'correction',
                          icon: <AuditOutlined />,
                          label: 'Stock correction',
                          onClick: () => setCountsOpen(true),
                        },
                        {
                          key: 'events',
                          icon: <HistoryOutlined />,
                          label: 'Event log',
                          onClick: () => setEventsOpen(true),
                        },
                        {
                          key: 'export',
                          icon: <DownloadOutlined />,
                          label: 'Export CSV',
                          onClick: () =>
                            exportCsv('consumables-stock.csv', filtered, stockCsvFields),
                        },
                      ],
                    }}
                  >
                    <Button icon={<MoreOutlined />} aria-label="More actions" />
                  </Dropdown>
                ) : (
                  <>
                    <Button icon={<AuditOutlined />} onClick={() => setCountsOpen(true)}>
                      Stock correction
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
                  </>
                )}
              </div>
            </div>

            {lowCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title={`${lowCount} item${lowCount === 1 ? '' : 's'} at or below reorder level`}
                action={
                  <Button size="small" onClick={() => setStockFilter(['low'])}>
                    Show low stock only
                  </Button>
                }
              />
            )}

              <ResponsiveTable
                card={{ subtitle: ['sizeSpec'], badge: 'status' }}
                className="std-list-table"
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={filtered}
                loading={loading}
                rowClassName={(r) => (r.lowStock ? 'inventory-low-stock' : '')}
                locale={{
                  emptyText:
                    tools.length === 0 ? (
                      <InventoryEmptyState
                        icon={PackageOpen}
                        title="Consumables appear here after their first supplier order is received."
                        action={
                          <Link to="/suppliers">
                            <Button type="link">Go to Suppliers and Orders</Button>
                          </Link>
                        }
                      />
                    ) : (
                      stockEmpty
                    ),
                }}
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
          </div>

          <Drawer
            title="Stock correction & movements"
            open={countsOpen}
            onClose={() => setCountsOpen(false)}
            size={isPhone ? '100%' : 880}
            destroyOnHidden
          >
            <StocktakePanel
              hideTitle
              readOnly={!canEdit}
              onSaved={() => {
                void fetchTools();
              }}
            />
          </Drawer>

          <Drawer
            title="Consumable event log"
            open={eventsOpen}
            onClose={() => setEventsOpen(false)}
            size={isPhone ? '100%' : 720}
            destroyOnHidden
          >
            <ToolEventsPage category="CONSUMABLE" />
          </Drawer>

          <Modal
            open={Boolean(editTool)}
            onCancel={() => setEditTool(null)}
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
                <EditOutlined />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="app-form-modal__title">Edit consumable</div>
                <div className="app-form-modal__sub">
                  {editTool ? `Update details for ${editTool.name}.` : 'Update item details.'}
                </div>
              </div>
              <button
                type="button"
                className="app-form-modal__close"
                onClick={() => setEditTool(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <Form
              form={editForm}
              layout="vertical"
              onFinish={onEdit}
              style={{ padding: '20px 24px 8px' }}
            >
              {sectionLabel('Item details')}
              <Form.Item
                name="name"
                label="Name"
                rules={[{ required: true }]}
                style={{ marginBottom: 14 }}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="shopTerm"
                label="Shop term"
                tooltip="What the shop calls it; searchable."
                style={{ marginBottom: 14 }}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="code"
                label="Code"
                rules={[{ required: true }]}
                style={{ marginBottom: 14 }}
              >
                <Input />
              </Form.Item>
              <Form.Item name="sizeSpec" label="Size / spec" style={{ marginBottom: 18 }}>
                <Input />
              </Form.Item>
              {sectionLabel('Stock levels')}
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="unit"
                    label="Unit"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 14 }}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="minimumStock" label="Reorder level" style={{ marginBottom: 14 }}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <div className="app-form-modal__footer">
              <Button onClick={() => setEditTool(null)} style={{ minWidth: 96 }}>
                Cancel
              </Button>
              <Button
                type="primary"
                loading={savingEdit}
                onClick={() => editForm.submit()}
                style={{ fontWeight: 700, minWidth: 120 }}
              >
                Save changes
              </Button>
            </div>
          </Modal>

          <Modal
            open={Boolean(adjustTool)}
            onCancel={() => setAdjustTool(null)}
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
                <AuditOutlined />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="app-form-modal__title">
                  {adjustTool ? `Correct stock: ${adjustTool.name}` : 'Correct stock'}
                </div>
                <div className="app-form-modal__sub">
                  Set the actual shelf count. Use Receive delivery for supplier stock.
                </div>
              </div>
              <button
                type="button"
                className="app-form-modal__close"
                onClick={() => setAdjustTool(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <Form
              form={adjustForm}
              layout="vertical"
              onFinish={onAdjust}
              style={{ padding: '20px 24px 8px' }}
            >
              {sectionLabel('Correction')}
              {adjustTool ? (
                <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
                  Current on hand: {adjustTool.quantityOnHand} {adjustTool.unit}
                </div>
              ) : null}
              <Form.Item
                name="actualCount"
                label="Actual count on shelf"
                rules={[{ required: true }]}
                style={{ marginBottom: 14 }}
              >
                <InputNumber min={0} style={{ width: '100%' }} addonAfter={adjustTool?.unit} />
              </Form.Item>
              <Form.Item
                name="reason"
                label="Reason"
                rules={[{ required: true, whitespace: true }]}
                style={{ marginBottom: 14 }}
              >
                <Input.TextArea rows={2} placeholder="e.g. Missed scans, damaged stock, recount" />
              </Form.Item>
            </Form>
            <div className="app-form-modal__footer">
              <Button onClick={() => setAdjustTool(null)} style={{ minWidth: 96 }}>
                Cancel
              </Button>
              <Button
                type="primary"
                onClick={() => adjustForm.submit()}
                style={{ fontWeight: 700, minWidth: 140 }}
              >
                Save correction
              </Button>
            </div>
          </Modal>

          <Modal
            open={Boolean(receiveTool)}
            onCancel={() => setReceiveTool(null)}
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
                  {receiveTool ? `Receive delivery: ${receiveTool.name}` : 'Receive delivery'}
                </div>
                <div className="app-form-modal__sub">
                  Increases stock on hand when a delivery arrives.
                </div>
              </div>
              <button
                type="button"
                className="app-form-modal__close"
                onClick={() => setReceiveTool(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <Form
              form={receiveForm}
              layout="vertical"
              onFinish={onReceive}
              style={{ padding: '20px 24px 8px' }}
              initialValues={{ receivedOn: shopToday(), quantity: 1 }}
            >
              {sectionLabel('Delivery')}
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[{ required: true }]}
                style={{ marginBottom: 14 }}
              >
                <InputNumber min={0.01} style={{ width: '100%' }} />
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
              <Button onClick={() => setReceiveTool(null)} style={{ minWidth: 96 }}>
                Cancel
              </Button>
              <Button
                type="primary"
                onClick={() => receiveForm.submit()}
                style={{ fontWeight: 700, minWidth: 140 }}
              >
                Receive delivery
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
