import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Switch,
  Typography,
  Space,
  Select,
  Dropdown,
  Row,
  Col,
  Spin,
  message,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  SearchOutlined,
  CheckSquareOutlined,
  MoreOutlined,
  ContactsOutlined,
} from '@ant-design/icons';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import { useIsPhone } from '../../hooks/useIsPhone';
import type { Client } from '../../types';

type NotifyFilter = 'email' | 'sms' | 'off';

function sectionLabel(text: string) {
  return (
    <div className="app-form-section">{text}</div>
  );
}

function notifyLabel(r: Client) {
  const parts = [r.notifyByEmail ? 'Email' : null, r.notifyBySms ? 'SMS' : null].filter(Boolean);
  return parts.join(' · ') || 'Off';
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [notifyFilter, setNotifyFilter] = useState<NotifyFilter[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const isPhone = useIsPhone();

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (
        q &&
        !`${c.name} ${c.contact || ''} ${c.email || ''} ${c.mobileNumber || ''}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (notifyFilter.length) {
        const off = !c.notifyByEmail && !c.notifyBySms;
        const match = notifyFilter.some((f) => {
          if (f === 'email') return !!c.notifyByEmail;
          if (f === 'sms') return !!c.notifyBySms;
          return off;
        });
        if (!match) return false;
      }
      return true;
    });
  }, [clients, search, notifyFilter]);

  const closeModal = () => setModalOpen(false);

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

  const columns: TableColumnsType<Client> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (n: string) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{n}</span>
      ),
    },
    {
      title: 'Contact',
      dataIndex: 'contact',
      key: 'contact',
      ellipsis: true,
      sorter: (a, b) => (a.contact || '').localeCompare(b.contact || ''),
      render: (v?: string) => (
        <span style={{ fontSize: 14, color: '#0f172a' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      sorter: (a, b) => (a.email || '').localeCompare(b.email || ''),
      render: (v?: string) => (
        <span style={{ fontSize: 13, color: '#475569' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Mobile',
      dataIndex: 'mobileNumber',
      key: 'mobileNumber',
      width: 140,
      sorter: (a, b) => (a.mobileNumber || '').localeCompare(b.mobileNumber || ''),
      render: (v?: string) => (
        <span style={{ fontSize: 13, color: '#475569' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Notify',
      key: 'notify',
      width: 140,
      render: (_: unknown, r: Client) => (
        r.notifyByEmail || r.notifyBySms ? (
          <StatusPill color="blue" compact>{notifyLabel(r)}</StatusPill>
        ) : (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Off</span>
        )
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      align: 'center',
      render: (_: unknown, r: Client) => {
        const items: MenuProps['items'] = [
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit',
            onClick: () => openEdit(r),
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

  return (
    <div className="std-list-page">
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Register client contact details for job update messages.
      </Typography.Text>

      <div className="std-list-toolbar">
        <div className="std-list-filters">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Search name, contact, email, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="std-list-search"
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Notify"
            className="std-list-filter std-list-filter--sm"
            value={notifyFilter}
            onChange={setNotifyFilter}
            options={[
              { value: 'email', label: 'Email' },
              { value: 'sms', label: 'SMS' },
              { value: 'off', label: 'Off' },
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
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ fontWeight: 700 }}>
            Register client
          </Button>
        </div>
      </div>

      {selectMode && (
        <div className="std-list-bulk">
          <span className="std-list-bulk__count">
            {selectedKeys.length ? `${selectedKeys.length} selected` : 'Select clients'}
          </span>
          <Space size={8}>
            {selectedKeys.length > 0 && (
              <Button size="small" type="text" onClick={() => setSelectedKeys([])}>
                Clear
              </Button>
            )}
          </Space>
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
            <div className="admin-cards__empty">No clients match your filters yet</div>
          )}
          {!loading &&
            filtered.map((c) => (
              <div key={c.id} className="admin-card" onClick={() => openEdit(c)} role="button" tabIndex={0}>
                <div className="admin-card__top">
                  <div>
                    <div className="admin-card__title">{c.name}</div>
                    <div className="admin-card__meta">
                      {[c.contact, c.email, c.mobileNumber].filter(Boolean).join(' · ') || 'No contact details'}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      menu={{
                        items: [{ key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => openEdit(c) }],
                      }}
                      trigger={['click']}
                      placement="bottomRight"
                    >
                      <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
                    </Dropdown>
                  </div>
                </div>
                <div className="admin-card__row">
                  {c.notifyByEmail || c.notifyBySms ? (
                    <StatusPill color="blue" compact>
                      {notifyLabel(c)}
                    </StatusPill>
                  ) : (
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Notify off</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      ) : (
      <Table
        className="std-list-table"
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (total) => `${total} client${total === 1 ? '' : 's'}`,
        }}
        locale={{ emptyText: 'No clients match your filters yet' }}
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
        className="app-form-modal"
        styles={{
          container: { padding: 0, borderRadius: 0, overflow: 'hidden' },
          body: { padding: 0 },
        }}
        closable={false}
      >
        <div className="app-form-modal__head">
          <div className="app-form-modal__icon">
            <ContactsOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="app-form-modal__title">{editing ? 'Edit client' : 'Register client'}</div>
            <div className="app-form-modal__sub">
              {editing
                ? 'Update contact details and how they get job updates.'
                : 'Company or person, plus how they should get job updates.'}
            </div>
          </div>
          <button type="button" className="app-form-modal__close" onClick={closeModal} aria-label="Close">
            ×
          </button>
        </div>

        <Form form={form} layout="vertical" style={{ padding: '20px 24px 8px' }}>
          {sectionLabel('Client')}
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
            style={{ marginBottom: 14 }}
          >
            <Input placeholder="Company or person name" />
          </Form.Item>
          <Form.Item name="contact" label="Contact person / notes" style={{ marginBottom: 18 }}>
            <Input placeholder="Optional — who to ask for, or a short note" />
          </Form.Item>

          {sectionLabel('Reach them')}
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ type: 'email', message: 'Enter a valid email' }]}
                style={{ marginBottom: 14 }}
              >
                <Input placeholder="client@example.com" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="mobileNumber" label="Mobile" style={{ marginBottom: 14 }}>
                <Input placeholder="+63917…" />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Job updates')}
          <div className="client-notify">
            <div className="client-notify__row">
              <div className="client-notify__copy">
                <div className="client-notify__title">Email</div>
                <div className="client-notify__hint">Send status updates to the address above</div>
              </div>
              <Form.Item name="notifyByEmail" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </div>
            <div className="client-notify__row">
              <div className="client-notify__copy">
                <div className="client-notify__title">SMS</div>
                <div className="client-notify__hint">Send status updates to the mobile number</div>
              </div>
              <Form.Item name="notifyBySms" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </div>
          </div>
        </Form>

        <div className="app-form-modal__footer">
          <Button onClick={closeModal} style={{ minWidth: 96 }}>
            Cancel
          </Button>
          <Button type="primary" loading={saving} onClick={onSave} style={{ fontWeight: 700, minWidth: 120 }}>
            {editing ? 'Save' : 'Register'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
