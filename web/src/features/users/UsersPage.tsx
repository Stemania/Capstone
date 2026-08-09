import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message, Row, Col,
} from 'antd';
import { PlusOutlined, UserAddOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type { User, WorkerSkill } from '../../types';

const NAVY = '#0f1c2e';

const roleStyle: Record<string, { label: string; color: PillColor }> = {
  ADMIN: { label: 'Administrator', color: 'blue' },
  OFFICE_STAFF: { label: 'Office Staff', color: 'amber' },
  PRODUCTION_WORKER: { label: 'Production Worker', color: 'green' },
};

type RoleFilter = 'all' | 'ADMIN' | 'OFFICE_STAFF' | 'PRODUCTION_WORKER';
type StatusFilter = 'all' | 'active' | 'inactive';
type SortKey = 'name_asc' | 'name_desc' | 'role_asc';

function skillLabels(user: User): string[] {
  const fromTop = user.skills || [];
  const fromProfile = user.workerProfile?.skills || [];
  const raw = fromTop.length ? fromTop : fromProfile;
  return raw
    .map((s) => (typeof s === 'string' ? s : (s as WorkerSkill).machineTypeCode || (s as WorkerSkill).machineTypeName || ''))
    .filter(Boolean) as string[];
}

export default function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name_asc');
  const [form] = Form.useForm();

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users.filter((u) => {
      if (q && !`${u.fullName} ${u.email}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.active) return false;
      if (statusFilter === 'inactive' && u.active) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'name_desc') return b.fullName.localeCompare(a.fullName);
      if (sort === 'role_asc') return a.role.localeCompare(b.role);
      return a.fullName.localeCompare(b.fullName);
    });
    return list;
  }, [users, query, roleFilter, statusFilter, sort]);

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const onCreate = async (values: {
    email: string;
    password: string;
    fullName: string;
    role: string;
  }) => {
    setSubmitting(true);
    try {
      const created = await usersApi.create({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        role: values.role,
      });
      message.success('User created');
      closeModal();
      if (values.role === 'PRODUCTION_WORKER') {
        navigate(`/users/${created.data.id}`);
      } else {
        fetchUsers();
      }
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
      render: (_: unknown, record: User) => {
        if (record.role !== 'PRODUCTION_WORKER') return '—';
        const labels = skillLabels(record);
        if (!labels.length) return <span style={{ color: '#94a3b8' }}>None</span>;
        return labels.map((s) => (
          <Tag key={s} style={{ borderRadius: 999 }}>{s}</Tag>
        ));
      },
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
      render: (_: unknown, record: User) => (
        <Space>
          {record.role === 'PRODUCTION_WORKER' && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/users/${record.id}`)}
            >
              Skills / Schedule
            </Button>
          )}
          {record.active ? (
            <Popconfirm title="Deactivate this user?" onConfirm={() => onDeactivate(record.id)}>
              <Button danger size="small">Deactivate</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
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
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Input
            allowClear
            placeholder="Search users..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 220 }}
          />
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            style={{ width: 170 }}
            options={[
              { value: 'all', label: 'All roles' },
              { value: 'ADMIN', label: 'Administrator' },
              { value: 'OFFICE_STAFF', label: 'Office Staff' },
              { value: 'PRODUCTION_WORKER', label: 'Production Worker' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <Select
            value={sort}
            onChange={setSort}
            style={{ width: 140 }}
            options={[
              { value: 'name_asc', label: 'Name A–Z' },
              { value: 'name_desc', label: 'Name Z–A' },
              { value: 'role_asc', label: 'Role' },
            ]}
          />
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ height: 32, fontWeight: 600 }}
        >
          Add User
        </Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        locale={{ emptyText: 'No users match your filters' }}
        scroll={{ x: true }}
        size="small"
      />

      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        width={560}
        centered
        destroyOnHidden
        className="add-user-modal"
        styles={{
          body: { padding: 0 },
        }}
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
              borderRadius: '50%',
              background: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            <UserAddOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Add User</div>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
              Create an account — set worker skills on the detail page after create
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
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
            style={{ marginBottom: 4 }}
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
