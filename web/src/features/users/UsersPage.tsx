import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Dropdown, message, Spin, Tooltip,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  UserAddOutlined,
  SearchOutlined,
  MoreOutlined,
  StopOutlined,
  CheckCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { usersApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import SelectMultipleIcon from '../../components/SelectMultipleIcon';
import { useIsPhone } from '../../hooks/useIsPhone';
import { PersonAvatar, PersonChip } from '../../components/PersonAvatar';
import PhotoUploadControl from '../../components/PhotoUploadControl';
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
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm] = Form.useForm();
  const editRole = Form.useWatch('role', editForm) as UserRole | undefined;
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
      if (q && !`${u.fullName} ${u.nickname || ''} ${u.email || ''}`.toLowerCase().includes(q))
        return false;
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
    nickname?: string;
    role: string;
    mobileNumber: string;
    inviteChannel: 'EMAIL' | 'SMS';
  }) => {
    setSubmitting(true);
    try {
          await usersApi.create({
            email: values.email,
            fullName: values.fullName,
            nickname: values.nickname?.trim() || undefined,
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

  const openEdit = (u: User) => {
    setEditUser(u);
    editForm.setFieldsValue({
      fullName: u.fullName,
      nickname: u.nickname || '',
      email: u.email || '',
      mobileNumber: u.mobileNumber || '',
      role: u.role,
    });
  };

  const sendInvite = async (u: User, channel: 'EMAIL' | 'SMS') => {
    try {
      await usersApi.resendInvite(u.id, channel);
      message.success(channel === 'EMAIL' ? 'Invitation emailed' : 'Invitation code sent by SMS');
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onEditSave = async (values: {
    fullName: string;
    nickname?: string;
    email?: string;
    mobileNumber?: string;
    role: UserRole;
  }) => {
    if (!editUser) return;
    setEditSaving(true);
    try {
      await usersApi.update(editUser.id, {
        fullName: values.fullName.trim(),
        nickname: (values.nickname || '').trim() || null,
        email: (values.email || '').trim() || null,
        mobileNumber: (values.mobileNumber || '').trim() || undefined,
        role: values.role,
      });
      message.success(
        values.role !== editUser.role
          ? 'Details saved. Their device PINs were revoked, so the new role applies at their next sign-in.'
          : 'Details saved'
      );
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setEditSaving(false);
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
      render: (_: string, record: User) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
          <PersonChip
            userId={record.id}
            fullName={record.fullName}
            nickname={record.nickname}
            photoVersion={record.photoVersion}
            size={26}
          />
        </span>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      sorter: (a, b) => (a.email || '').localeCompare(b.email || ''),
      render: (v: string | null) =>
        v ? (
          <span style={{ fontSize: 13, color: '#475569' }}>{v}</span>
        ) : (
          <span style={{ fontSize: 13, color: '#94a3b8' }}>No email yet</span>
        ),
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
        const items: MenuProps['items'] = [
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit details',
            onClick: () => openEdit(record),
          },
        ];
        const status = record.status || (record.active ? 'ACTIVE' : 'DISABLED');
        if (status === 'INVITED') {
          if (record.email) {
            items.push({
              key: 'invite-email',
              label: 'Send invite by email',
              onClick: () => sendInvite(record, 'EMAIL'),
            });
          }
          if (record.mobileNumber) {
            items.push({
              key: 'invite-sms',
              label: 'Send invite by SMS',
              onClick: () => sendInvite(record, 'SMS'),
            });
          }
          if (!record.email && !record.mobileNumber) {
            items.push({
              key: 'invite-needs-contact',
              label: 'Add email or mobile to invite',
              onClick: () => openEdit(record),
            });
          }
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
          <Tooltip title={selectMode ? 'Done selecting' : 'Select multiple'}>
            <Button
              icon={<SelectMultipleIcon />}
              type={selectMode ? 'primary' : 'default'}
              ghost={selectMode}
              aria-label={selectMode ? 'Done selecting' : 'Select multiple'}
              onClick={() => {
                if (selectMode) {
                  setSelectMode(false);
                  setSelectedKeys([]);
                } else {
                  setSelectMode(true);
                }
              }}
            />
          </Tooltip>
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
                      <div className="admin-card__title">
                        <PersonChip
                          userId={u.id}
                          fullName={u.fullName}
                          nickname={u.nickname}
                          photoVersion={u.photoVersion}
                          size={26}
                        />
                      </div>
                      <div className="admin-card__meta">{u.email || 'No email yet'}</div>
                    </div>
                    <Dropdown
                      menu={{
                        items: [
                          {
                            key: 'edit',
                            icon: <EditOutlined />,
                            label: 'Edit details',
                            onClick: () => openEdit(u),
                          },
                          ...((u.status || (u.active ? 'ACTIVE' : 'DISABLED')) === 'DISABLED'
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
                              ]),
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

          <Form.Item name="nickname" label="Nickname" style={{ marginBottom: 14 }}>
            <Input size="large" maxLength={40} placeholder="e.g. JD" />
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

      <Modal
        open={!!editUser}
        title={editUser ? `Edit ${editUser.fullName}` : 'Edit user'}
        onCancel={() => setEditUser(null)}
        onOk={() => editForm.submit()}
        okText="Save"
        confirmLoading={editSaving}
        forceRender
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={onEditSave}
          requiredMark="optional"
          style={{ marginTop: 12 }}
        >
          {editUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <PersonAvatar
                userId={editUser.id}
                fullName={editUser.fullName}
                photoVersion={editUser.photoVersion}
                size={56}
              />
              <PhotoUploadControl
                user={editUser}
                onChange={(updated) => {
                  setEditUser((prev) => (prev ? { ...prev, photoVersion: updated.photoVersion } : prev));
                  setUsers((prev) =>
                    prev.map((x) => (x.id === updated.id ? { ...x, photoVersion: updated.photoVersion } : x))
                  );
                }}
              />
            </div>
          ) : null}
          <Form.Item
            name="fullName"
            label="Full Name"
            rules={[{ required: true, whitespace: true, message: 'Full name is required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="Nickname"
            extra='Shown with the name, e.g. "PJ · Anthony Pajantoy".'
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Valid email required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="mobileNumber"
            label="Mobile number"
            extra={
              editUser?.status === 'INVITED'
                ? 'Add an email or mobile number, save, then send the invite from the row menu.'
                : undefined
            }
          >
            <Input placeholder="09XX XXX XXXX" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
            <Select
              options={[
                { value: 'ADMIN', label: 'Administrator' },
                { value: 'OFFICE_STAFF', label: 'Office Staff' },
                { value: 'PRODUCTION_WORKER', label: 'Production Worker' },
              ]}
            />
          </Form.Item>
          {editUser && editRole && editRole !== editUser.role ? (
            <div style={{ fontSize: 12, color: '#b45309' }}>
              Changing the role revokes this user&apos;s device PINs. They must sign in with their
              password next time, and the new role applies from then.
            </div>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
