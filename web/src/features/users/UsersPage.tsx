import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Typography, Space, Popconfirm, message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { usersApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { User } from '../../types';

const { Title } = Typography;

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
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

  const onCreate = async (values: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    skills?: string;
  }) => {
    try {
      await usersApi.create({
        ...values,
        skills: values.skills ? values.skills.split(',').map((s) => s.trim()) : undefined,
      });
      message.success('User created');
      setModalOpen(false);
      form.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
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
    { title: 'Name', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (r: string) => <Tag>{r.replace('_', ' ')}</Tag>,
    },
    {
      title: 'Skills',
      key: 'skills',
      render: (_: unknown, record: User) =>
        record.workerProfile?.skills?.map((s) => <Tag key={s}>{s}</Tag>),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      render: (a: boolean) => <Tag color={a ? 'green' : 'red'}>{a ? 'Active' : 'Inactive'}</Tag>,
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

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>User Management</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Add User
        </Button>
      </Space>

      <Table rowKey="id" columns={columns} dataSource={users} loading={loading} scroll={{ x: true }} />

      <Modal title="Add User" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ADMIN', label: 'Admin' },
                { value: 'OFFICE_STAFF', label: 'Office Staff' },
                { value: 'PRODUCTION_WORKER', label: 'Production Worker' },
              ]}
            />
          </Form.Item>
          <Form.Item name="skills" label="Skills (comma-separated, for workers)">
            <Input placeholder="milling, lathe, welding" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Create</Button>
        </Form>
      </Modal>
    </div>
  );
}
