import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message, Row, Col,
} from 'antd';
import { PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { usersApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type { User } from '../../types';

const NAVY = '#0f1c2e';

const roleStyle: Record<string, { label: string; color: PillColor }> = {
  ADMIN: { label: 'Administrator', color: 'blue' },
  OFFICE_STAFF: { label: 'Office Staff', color: 'amber' },
  PRODUCTION_WORKER: { label: 'Production Worker', color: 'green' },
};

const skillPresets = [
  'milling',
  'lathe',
  'grinding',
  'welding',
  'drilling',
  'shaper',
  'cnc',
  'finishing',
];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const selectedRole = Form.useWatch('role', form);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await usersApi.list();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const onCreate = async (values: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    skills?: string[];
  }) => {
    setSubmitting(true);
    try {
      await usersApi.create({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        role: values.role,
        skills: values.role === 'PRODUCTION_WORKER' ? values.skills : undefined,
      });
      message.success('User created');
      closeModal();
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDeactivate = async (id: string) => {
    try {
      await usersApi.deactivate(id);
      message.success('User deactivated');
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span>,
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (r: string) => {
        const st = roleStyle[r] || { label: r.replace('_', ' '), color: 'gray' as PillColor };
        return <StatusPill color={st.color}>{st.label}</StatusPill>;
      },
    },
    {
      title: 'Skills',
      key: 'skills',
      render: (_: unknown, record: User) =>
        record.workerProfile?.skills?.map((s) => (
          <Tag key={s} style={{ borderRadius: 999 }}>{s}</Tag>
        )),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      render: (a: boolean) => (
        <StatusPill color={a ? 'green' : 'red'}>{a ? 'Active' : 'Inactive'}</StatusPill>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: User) =>
        record.active ? (
          <Popconfirm title="Deactivate this user?" onConfirm={() => onDeactivate(record.id)}>
            <Button danger size="small">Deactivate</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: '#64748b',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid #e2e8f0',
      }}
    >
      {text}
    </div>
  );

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ fontWeight: 600 }}
        >
          Add User
        </Button>
      </Space>

      <Table rowKey="id" columns={columns} dataSource={users} loading={loading} scroll={{ x: true }} />

      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        width={560}
        destroyOnHidden
        styles={{
          body: { padding: 0 },
        }}
        style={{ borderRadius: 14, overflow: 'hidden', padding: 0 }}
        closable={false}
      >
        <div
          style={{
            background: NAVY,
            color: '#fff',
            padding: '18px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            <UserAddOutlined />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Add User</div>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
              Create an account for admin, office staff, or a production worker
            </div>
          </div>
          <button
            onClick={closeModal}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={onCreate}
          requiredMark="optional"
          style={{ padding: '20px 24px 8px' }}
          initialValues={{ role: 'PRODUCTION_WORKER' }}
        >
          {sectionLabel('Account details')}

          <Form.Item
            name="fullName"
            label="Full Name"
            rules={[{ required: true, message: 'Full name is required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input size="large" placeholder="e.g. Juan Dela Cruz" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={14}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ required: true, type: 'email', message: 'Valid email required' }]}
                style={{ marginBottom: 14 }}
              >
                <Input size="large" placeholder="name@bmsc.local" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item
                name="password"
                label="Password"
                rules={[{ required: true, min: 6, message: 'Min. 6 characters' }]}
                style={{ marginBottom: 14 }}
              >
                <Input.Password size="large" placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Role & access')}

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true }]}
            style={{ marginBottom: selectedRole === 'PRODUCTION_WORKER' ? 14 : 4 }}
          >
            <Select
              size="large"
              options={[
                { value: 'ADMIN', label: 'Administrator' },
                { value: 'OFFICE_STAFF', label: 'Office Staff' },
                { value: 'PRODUCTION_WORKER', label: 'Production Worker' },
              ]}
            />
          </Form.Item>

          {selectedRole === 'PRODUCTION_WORKER' && (
            <Form.Item
              name="skills"
              label="Skills"
              extra="Select shop skills used for worker assignment suggestions"
              style={{ marginBottom: 8 }}
            >
              <Select
                mode="tags"
                size="large"
                placeholder="Select or type skills"
                tokenSeparators={[',']}
                options={skillPresets.map((s) => ({ value: s, label: s }))}
              />
            </Form.Item>
          )}
        </Form>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '14px 24px 20px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <Button onClick={closeModal} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={() => form.submit()}
            style={{ fontWeight: 700, minWidth: 120 }}
          >
            Create User
          </Button>
        </div>
      </Modal>
    </div>
  );
}
