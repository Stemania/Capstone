import { useEffect, useMemo, useState } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, Switch, Table, Tag, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, ExperimentOutlined } from '@ant-design/icons';
import {
  MATERIAL_UNITS,
  materialCatalogApi,
  materialMatches,
  type MaterialCatalogInput,
  type MaterialCatalogItem,
} from '../../api/materialCatalog.api';
import { getErrorMessage } from '../../api/client';
import { invalidateMaterialCatalog } from '../../hooks/useMaterialCatalog';
import StatusPill from '../../components/StatusPill';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

/** Common raw materials suggested on order lines. Office Staff manage it;
 *  the Admin views it. */
export default function MaterialCatalogPanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<MaterialCatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MaterialCatalogItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data } = await materialCatalogApi.list({ includeInactive: true });
      setRows(data.items);
      setCategories(data.categories);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  const filtered = useMemo(() => rows.filter((r) => materialMatches(r, query)), [rows, query]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ defaultUnit: 'kg', grades: [], active: true });
    setModalOpen(true);
  };

  const openEdit = (r: MaterialCatalogItem) => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name,
      shopTerm: r.shopTerm,
      grades: r.grades,
      defaultUnit: r.defaultUnit,
      category: r.category,
      active: r.active,
    });
    setModalOpen(true);
  };

  const onSave = async (values: MaterialCatalogInput) => {
    try {
      setSaving(true);
      if (editing) {
        await materialCatalogApi.update(editing.id, values);
        message.success('Material updated');
      } else {
        await materialCatalogApi.create(values);
        message.success('Material added');
      }
      invalidateMaterialCatalog();
      setModalOpen(false);
      await fetchRows();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<MaterialCatalogItem> = [
    {
      title: 'Material',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.name}</div>
          {r.shopTerm ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>Shop term: “{r.shopTerm}”</div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Grades / specs',
      dataIndex: 'grades',
      render: (grades: string[]) =>
        grades.length ? grades.map((g) => <Tag key={g}>{g}</Tag>) : <span style={{ color: '#94a3b8' }}>—</span>,
    },
    { title: 'Unit', dataIndex: 'defaultUnit', width: 80 },
    {
      title: 'Category',
      dataIndex: 'category',
      width: 130,
      sorter: (a, b) => (a.category || '').localeCompare(b.category || ''),
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: 100,
      render: (v: boolean) =>
        v ? (
          <StatusPill color="green" compact>Offered</StatusPill>
        ) : (
          <StatusPill color="gray" compact>Hidden</StatusPill>
        ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 56,
            render: (_: unknown, r: MaterialCatalogItem) => (
              <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="std-list-page">
      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            placeholder="Search name, shop term, grade…"
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="std-list-search"
          />
        </div>
        <div className="std-list-actions">
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ fontWeight: 700 }}>
              Add material
            </Button>
          )}
        </div>
      </div>

      <Table
        className="std-list-table"
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: 720 }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{
          emptyText: rows.length
            ? 'No materials match your search.'
            : 'No materials in the catalog yet.',
        }}
      />

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={600}
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
            <ExperimentOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">{editing ? 'Edit material' : 'Add material'}</div>
            <div className="app-form-modal__sub">
              Suggested when entering order lines; free text is still allowed.
            </div>
          </div>
          <button
            type="button"
            className="app-form-modal__close"
            onClick={() => setModalOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <Form form={form} layout="vertical" onFinish={onSave} style={{ padding: '20px 24px 8px' }}>
          {sectionLabel('Material')}
          <Row gutter={12}>
            <Col xs={24} md={14}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input placeholder="e.g. AISI 4140 alloy steel" />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item
                name="shopTerm"
                label="Shop term"
                tooltip="What the shop calls it; searching by it finds this entry."
              >
                <Input placeholder="e.g. 41-40" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="grades"
            label="Grade / spec suggestions"
            tooltip="Type a grade and press Enter to add it."
          >
            <Select mode="tags" open={false} placeholder="e.g. A36" tokenSeparators={[',']} />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={12} md={8}>
              <Form.Item name="defaultUnit" label="Default unit" rules={[{ required: true }]}>
                <Select options={MATERIAL_UNITS.map((u) => ({ value: u, label: u }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={10}>
              <Form.Item name="category" label="Category">
                <Select allowClear options={categories.map((c) => ({ value: c, label: c }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="active" label="Offered" valuePropName="checked">
                <Switch checkedChildren="Yes" unCheckedChildren="No" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <div className="app-form-modal__footer">
          <Button onClick={() => setModalOpen(false)} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => form.submit()}
            style={{ fontWeight: 700, minWidth: 120 }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}
