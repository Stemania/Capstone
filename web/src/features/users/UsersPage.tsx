import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Dropdown, message, Spin, Alert,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  UserAddOutlined,
  SearchOutlined,
  CheckSquareOutlined,
  MoreOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { usersApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import { useIsPhone } from '../../hooks/useIsPhone';
import type { User, UserRole } from '../../types';

const NAVY = '#0f1c2e';

const roleStyle: Record<string, { label: string; color: PillColor }> = {
  ADMIN: { label: 'Administrator', color: 'blue' },
  OFFICE_STAFF: { label: 'Office Staff', color: 'amber' },
  PRODUCTION_WORKER: { label: 'Production Worker', color: 'teal' },
};

type StatusFilter = 'active' | 'inactive';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const isPhone = useIsPhone();

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
    return users.filter((u) => {
      if (q && !`${u.fullName} ${u.email}`.toLowerCase().includes(q)) return false;
      if (roleFilter.length && !roleFilter.includes(u.role)) return false;
      if (statusFilter.length) {
        const status: StatusFilter = u.active ? 'active' : 'inactive';
        if (!statusFilter.includes(status)) return false;
      }
      return true;
    });
  }, [users, query, roleFilter, statusFilter]);

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const onCreate = async (values: {
    email: string;
    fullName: string;
    role: string;
    mobileNumber: string;
    inviteChannel: 'EMAIL' | 'SMS';
  }) => {
    setSubmitting(true);
    try {
          await usersApi.create({
            email: values.email,
            fullName: values.fullName,
            role: values.role,
            mobileNumber: values.mobileNumber,
            inviteChannel: values.inviteChannel,
          });
          message.success('Invitation sent. The user must set their own password.');
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
      message.success('User disabled. Their production history is kept.');
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onReenable = async (id: string) => {
    try {
      await usersApi.update(id, { active: true });
      message.success('User re-enabled');
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const confirmDisable = (id: string, name: string) => {
    Modal.confirm({
      title: `Disable ${name}?`,
      content:
        'They will not be able to sign in. Job history, time logs, and audit records stay in the system.',
      okText: 'Disable',
      okButtonProps: { danger: true },
      onOk: () => onDeactivate(id),
    });
  };

  const columns: TableColumnsType<User> = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'fullName',
      sorter: (a, b) => a.fullName.localeCompare(b.fullName),
      render: (n: string) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{n}</span>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      sorter: (a, b) => a.email.localeCompare(b.email),
      render: (v: string) => <span style={{ fontSize: 13, color: '#475569' }}>{v}</span>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 170,
      render: (r: string) => {
        const st = roleStyle[r] || { label: r.replace('_', ' '), color: 'gray' as PillColor };
        return <StatusPill color={st.color} compact>{st.label}</StatusPill>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (_: unknown, record: User) => {
        const status = record.status || (record.active ? 'ACTIVE' : 'DISABLED');
        const color =
          status === 'ACTIVE' ? 'green' : status === 'INVITED' ? 'amber' : 'red';
        const label =
          status === 'ACTIVE' ? 'Active' : status === 'INVITED' ? 'Invited' : 'Disabled';
        return (
          <StatusPill color={color} compact>
            {label}
          </StatusPill>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      align: 'center',
      render: (_: unknown, record: User) => {
        const items: MenuProps['items'] = [];
        const status = record.status || (record.active ? 'ACTIVE' : 'DISABLED');
        if (status === 'INVITED') {
          items.push({
            key: 'resend',
            label: 'Resend invite',
            onClick: async () => {
              try {
                await usersApi.resendInvite(record.id);
                message.success('Invitation resent');
                fetchUsers();
              } catch (err) {
                message.error(getErrorMessage(err));
              }
            },
          });
          items.push({
            key: 'revoke-invite',
            label: 'Revoke invite',
            onClick: async () => {
              try {
                await usersApi.revokeInvite(record.id);
                message.success('Invitation revoked');
                fetchUsers();
              } catch (err) {
                message.error(getErrorMessage(err));
              }
            },
          });
        }
        if (status === 'ACTIVE') {
          items.push({
            key: 'revoke-devices',
            label: 'Revoke all devices',
            onClick: () => {
              Modal.confirm({
                title: 'Revoke all device PINs for this user?',
                onOk: async () => {
                  await usersApi.revokeDevices(record.id);
                  message.success('Devices revoked');
                },
              });
            },
          });
        }
        if (status !== 'DISABLED') {
          items.push({
            key: 'deactivate',
            icon: <StopOutlined />,
            danger: true,
            label: 'Disable',
            onClick: () => confirmDisable(record.id, record.fullName),
          });
        } else {
          items.push({
            key: 'reenable',
            icon: <CheckCircleOutlined />,
            label: 'Re-enable',
            onClick: () => {
              Modal.confirm({
                title: `Re-enable ${record.fullName}?`,
                content: 'They will be able to sign in again with their existing password.',
                okText: 'Re-enable',
                onOk: () => onReenable(record.id),
              });
            },
          });
        }
        if (!items.length) return null;
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
    <div className="std-list-page">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Users are disabled, not deleted"
        description="Disable stops sign-in but keeps production history, time logs, and audit records. Re-enable restores access."
      />
      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            placeholder="Search name or email…"
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="std-list-search"
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Role"
            className="std-list-filter"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: 'ADMIN', label: 'Administrator' },
              { value: 'OFFICE_STAFF', label: 'Office Staff' },
              { value: 'PRODUCTION_WORKER', label: 'Production Worker' },
            ]}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Status"
            className="std-list-filter std-list-filter--sm"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </div>
        <div className="std-list-actions">
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
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
            style={{ fontWeight: 700 }}
          >
            Add User
          </Button>
        </div>
      </div>

      {selectMode && (
        <div className="std-list-bulk">
          <span className="std-list-bulk__count">
            {selectedKeys.length ? `${selectedKeys.length} selected` : 'Select users'}
          </span>
          {selectedKeys.length > 0 && (
            <Button size="small" type="text" onClick={() => setSelectedKeys([])}>
              Clear
            </Button>
          )}
        </div>
      )}

      {isPhone ? (
        <div className="admin-cards">
          {loading && (
            <div className="page-spinner">
              <Spin />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="admin-cards__empty">No users match your filters yet</div>
          )}
          {!loading &&
            filtered.map((u) => {
              const st = roleStyle[u.role] || { label: u.role.replace('_', ' '), color: 'gray' as PillColor };
              return (
                <div key={u.id} className="admin-card">
                  <div className="admin-card__top">
                    <div>
                      <div className="admin-card__title">{u.fullName}</div>
                      <div className="admin-card__meta">{u.email}</div>
                    </div>
                    <Dropdown
                      menu={{
                        items:
                          (u.status || (u.active ? 'ACTIVE' : 'DISABLED')) === 'DISABLED'
                            ? [
                                {
                                  key: 'reenable',
                                  icon: <CheckCircleOutlined />,
                                  label: 'Re-enable',
                                  onClick: () => {
                                    Modal.confirm({
                                      title: `Re-enable ${u.fullName}?`,
                                      content:
                                        'They will be able to sign in again with their existing password.',
                                      okText: 'Re-enable',
                                      onOk: () => onReenable(u.id),
                                    });
                                  },
                                },
                              ]
                            : [
                                {
                                  key: 'deactivate',
                                  icon: <StopOutlined />,
                                  danger: true,
                                  label: 'Disable',
                                  onClick: () => confirmDisable(u.id, u.fullName),
                                },
                              ],
                      }}
                      trigger={['click']}
                      placement="bottomRight"
                    >
                      <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
                    </Dropdown>
                  </div>
                  <div className="admin-card__row">
                    <StatusPill color={st.color} compact>
                      {st.label}
                    </StatusPill>
                    <StatusPill color={u.active ? 'green' : 'red'} compact>
                      {u.active ? 'Active' : 'Inactive'}
                    </StatusPill>
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
      <Table
        className="std-list-table"
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        locale={{ emptyText: 'No users match your filters yet' }}
        size="small"
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (total) => `${total} user${total === 1 ? '' : 's'}`,
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
      )}

      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        width={560}
        centered
        destroyOnHidden
        className="add-user-modal"
        styles={{
          container: { padding: 0, borderRadius: 0, overflow: 'hidden' },
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
              Create an account. Set worker skills and hours under Worker setup.
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

          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, type: 'email', message: 'Valid email required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input size="large" placeholder="name@bmsc.local" />
          </Form.Item>

          <Form.Item
            name="mobileNumber"
            label="Mobile number"
            rules={[{ required: true, message: 'Mobile number is required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input size="large" placeholder="09XX XXX XXXX" />
          </Form.Item>

          <Form.Item
            name="inviteChannel"
            label="Send invite via"
            rules={[{ required: true }]}
            style={{ marginBottom: 14 }}
            initialValue="EMAIL"
          >
            <Select
              size="large"
              options={[
                { value: 'EMAIL', label: 'Email link' },
                { value: 'SMS', label: 'SMS code' },
              ]}
            />
          </Form.Item>

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
