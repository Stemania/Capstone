import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Space,
  message,
  Tag,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, EditOutlined, ShopOutlined } from '@ant-design/icons';
import { suppliersApi } from '../../api/suppliers.api';
import { getErrorMessage } from '../../api/client';
import type { Supplier } from '../../types';
import StatusPill from '../../components/StatusPill';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data } = await suppliersApi.list();
      setRows(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.contactPerson || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ active: true, typicalLeadTimeDays: 5 });
    setModalOpen(true);
  };

  const openEdit = (r: Supplier) => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name,
      contactPerson: r.contactPerson,
      phone: r.phone,
      email: r.email,
      address: r.address,
      typicalLeadTimeDays: r.typicalLeadTimeDays,
      notes: r.notes,
      active: r.active,
    });
    setModalOpen(true);
  };

  const onSave = async (values: Record<string, unknown>) => {
    try {
      setSaving(true);
      if (editing) {
        await suppliersApi.update(editing.id, values);
        message.success('Supplier updated');
      } else {
        await suppliersApi.create(values as { name: string });
        message.success('Supplier added');
      }
      setModalOpen(false);
      await fetchRows();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<Supplier> = [
    {
      title: 'Supplier',
      key: 'name',
      render: (_: unknown, r) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.name}{' '}
            {r.isSeed ? <Tag style={{ marginLeft: 4 }}>Seed</Tag> : null}
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{r.contactPerson || '—'}</div>
        </div>
      ),
    },
    { title: 'Phone', dataIndex: 'phone', width: 130, render: (v) => v || '—' },
    {
      title: 'Lead time',
      dataIndex: 'typicalLeadTimeDays',
      width: 110,
      render: (v: number | null) => (v == null ? '—' : `${v} day${v === 1 ? '' : 's'}`),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: 100,
      render: (v: boolean) =>
        v ? (
          <StatusPill color="green" compact>
            Active
          </StatusPill>
        ) : (
          <StatusPill color="gray" compact>
            Inactive
          </StatusPill>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 72,
      render: (_: unknown, r) => (
        <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
      ),
    },
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
        <Input
          allowClear
          placeholder="Search suppliers"
          prefix={<ShopOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add supplier
        </Button>
      </div>

      <Table
        className="std-list-table"
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 20 }}
      />

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
            <ShopOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">
              {editing ? 'Edit supplier' : 'Add supplier'}
            </div>
            <div className="app-form-modal__sub">
              Used on job material purchases and lead-time analytics.
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
        <Form
          form={form}
          layout="vertical"
          onFinish={onSave}
          style={{ padding: '20px 24px 8px' }}
        >
          {sectionLabel('Details')}
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactPerson" label="Contact person">
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="phone" label="Phone" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email" style={{ flex: 1 }}>
              <Input type="email" />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="typicalLeadTimeDays" label="Typical lead time (days)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
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
