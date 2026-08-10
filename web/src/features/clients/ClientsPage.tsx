import { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Switch,
  Typography,
  Space,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { Client } from '../../types';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data } = await clientsApi.list();
      setClients(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      notifyByEmail: false,
      notifyBySms: false,
    });
    setModalOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    form.setFieldsValue({
      name: c.name,
      contact: c.contact,
      email: c.email,
      mobileNumber: c.mobileNumber,
      notifyByEmail: !!c.notifyByEmail,
      notifyBySms: !!c.notifyBySms,
    });
    setModalOpen(true);
  };

  const onSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        name: values.name,
        contact: values.contact || undefined,
        email: values.email || undefined,
        mobileNumber: values.mobileNumber || undefined,
        notifyByEmail: !!values.notifyByEmail,
        notifyBySms: !!values.notifyBySms,
      };
      if (editing) {
        await clientsApi.update(editing.id, payload);
        message.success('Client updated');
      } else {
        await clientsApi.create(payload);
        message.success('Client registered');
      }
      setModalOpen(false);
      fetchClients();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span>,
    },
    { title: 'Contact', dataIndex: 'contact', key: 'contact', render: (v?: string) => v || '—' },
    { title: 'Email', dataIndex: 'email', key: 'email', render: (v?: string) => v || '—' },
    {
      title: 'Mobile',
      dataIndex: 'mobileNumber',
      key: 'mobileNumber',
      render: (v?: string) => v || '—',
    },
    {
      title: 'Notify',
      key: 'notify',
      width: 140,
      render: (_: unknown, r: Client) => (
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {[r.notifyByEmail ? 'Email' : null, r.notifyBySms ? 'SMS' : null]
            .filter(Boolean)
            .join(' · ') || 'Off'}
        </span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, r: Client) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Text type="secondary">
          Register client contact details for job milestone notifications. No client portal or login.
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Register client
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={clients}
        columns={columns}
        pagination={{ pageSize: 20 }}
        size="middle"
      />

      <Modal
        title={editing ? 'Edit client' : 'Register client'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        confirmLoading={saving}
        destroyOnClose
        okText={editing ? 'Save' : 'Register'}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Company or person name" />
          </Form.Item>
          <Form.Item name="contact" label="Contact person / notes">
            <Input placeholder="Optional" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Invalid email' }]}>
            <Input placeholder="client@example.com" />
          </Form.Item>
          <Form.Item name="mobileNumber" label="Mobile number">
            <Input placeholder="+63917…" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="notifyByEmail" label="Notify by email" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="notifyBySms" label="Notify by SMS" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
