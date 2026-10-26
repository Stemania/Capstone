import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Row,
  Col,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, EditOutlined, ShopOutlined } from '@ant-design/icons';
import { suppliersApi } from '../../api/suppliers.api';
import { getErrorMessage } from '../../api/client';
import type { Supplier, SupplierReliability } from '../../types';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import { DataTable, EmptyState, EllipsisText, FilterBar, FilterSelect, TwoLineCell, rowOpenProps } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useViewport';

const GRADE_COLOR: Record<string, PillColor> = { A: 'green', B: 'blue', C: 'amber', D: 'red' };

type StatusFilter = 'active' | 'inactive';
type GradeFilter = 'A' | 'B' | 'C' | 'D' | 'none';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

export default function SuppliersPage() {
  const { canManageContacts: canEdit } = useAuth();
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

  const phone = useMediaQuery(PHONE_QUERY);
  const [reliability, setReliability] = useState<Record<string, SupplierReliability>>({});
  useEffect(() => {
    suppliersApi
      .reliability()
      .then(({ data }) => setReliability(Object.fromEntries(data.map((r) => [r.supplierId, r]))))
      .catch(() => undefined);
  }, []);

  const [statusFilter, setStatusFilter] = useState<StatusFilter | undefined>();
  const [gradeFilter, setGradeFilter] = useState<GradeFilter[]>([]);
  const activeFilters = (statusFilter ? 1 : 0) + (gradeFilter.length ? 1 : 0);
  const gradeOf = (r: Supplier): GradeFilter => {
    const s = reliability[r.id];
    return s?.score != null && s.grade ? (s.grade as GradeFilter) : 'none';
  };
  const scoreOf = (r: Supplier) => reliability[r.id]?.score ?? -1;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'active' && !r.active) return false;
      if (statusFilter === 'inactive' && r.active) return false;
      if (gradeFilter.length && !gradeFilter.includes(gradeOf(r))) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.code || '').toLowerCase().includes(q) ||
        (r.contactPerson || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, gradeFilter, reliability]);

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
      code: r.code,
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

  const nameTags = (r: Supplier) => (
    <>
      {r.code ? <span className="supplier-code-text">{r.code}</span> : null}
      {r.isSeed ? <span className="supplier-code-text supplier-code-text--muted">Seed</span> : null}
    </>
  );

  const columns: TableColumnsType<Supplier> = [
    {
      title: 'Supplier',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r) =>
        phone ? (
          r.name
        ) : (
          <TwoLineCell
            primary={
              <>
                {r.name}
                {nameTags(r)}
              </>
            }
            secondary={r.contactPerson || null}
          />
        ),
    },
    ...(phone
      ? [
          {
            title: 'Code',
            key: 'code',
            render: (_: unknown, r: Supplier) =>
              r.code ? <span className="supplier-mcode">{r.code}</span> : null,
          },
        ]
      : []),
    phone
      ? {
          title: 'Contact',
          key: 'contact',
          render: (_: unknown, r: Supplier) => [r.contactPerson, r.phone].filter(Boolean).join(' · ') || null,
        }
      : {
          title: 'Phone',
          dataIndex: 'phone',
          width: 130,
          ellipsis: true,
          render: (v: string | null) => <EllipsisText>{v || '—'}</EllipsisText>,
        },
    {
      title: 'Lead time',
      dataIndex: 'typicalLeadTimeDays',
      width: 110,
      sorter: (a, b) => (a.typicalLeadTimeDays ?? Infinity) - (b.typicalLeadTimeDays ?? Infinity),
      render: (v: number | null) => (v == null ? '—' : `${v} day${v === 1 ? '' : 's'}`),
    },
    {
      title: 'Reliability',
      key: 'score',
      width: 150,
      sorter: (a, b) => scoreOf(a) - scoreOf(b),
      render: (_: unknown, r: Supplier) => {
        const s = reliability[r.id];
        if (s?.score == null || !s.grade) {
          return s?.dueDeliveries ? <span style={{ fontSize: 12, color: '#94a3b8' }}>Too few deliveries</span> : '—';
        }
        return (
          <StatusPill color={GRADE_COLOR[s.grade] ?? 'gray'} plain>
            {s.grade} · {Math.round(s.score)}
          </StatusPill>
        );
      },
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
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 72,
            render: (_: unknown, r: Supplier) => (
              <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search name, code, contact, phone…' }}
        activeFilters={activeFilters}
        onClearFilters={() => {
          setStatusFilter(undefined);
          setGradeFilter([]);
        }}
        filters={
          <>
            <FilterSelect<StatusFilter>
              label="Status"
              allowClear
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <FilterSelect<GradeFilter[]>
              label="Grade"
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={gradeFilter}
              onChange={setGradeFilter}
              options={[
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
                { value: 'D', label: 'D' },
                { value: 'none', label: 'Not rated yet' },
              ]}
            />
          </>
        }
        actions={
          <>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                Add supplier
              </Button>
            ) : null}
          </>
        }
      />

      <DataTable<Supplier>
        card={{ title: 'name', subtitle: ['code', 'contact'], badge: 'active', actions: 'none', hide: ['actions'] }}
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        onRow={canEdit ? (r) => rowOpenProps(() => openEdit(r)) : undefined}
        locale={{
          emptyText: (
            <EmptyState
              compact
              icon={<ShopOutlined />}
              title={search ? 'No suppliers match your search' : 'No suppliers yet'}
            />
          ),
        }}
      />

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={760}
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
          {sectionLabel('Supplier')}
          <Row gutter={16}>
            <Col xs={16} md={9}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item
                name="code"
                label="Code"
                tooltip="2 to 5 letters that start this supplier's PO numbers (e.g. STP gives STP26000001). Needed before a PO can be issued."
                normalize={(v: string) => (v || '').toUpperCase().replace(/[^A-Z]/g, '')}
                rules={[{ pattern: /^[A-Z]{2,5}$/, message: '2 to 5 letters' }]}
              >
                <Input maxLength={5} placeholder="RIC" />
              </Form.Item>
            </Col>
            <Col xs={14} md={6}>
              <Form.Item
                name="typicalLeadTimeDays"
                label="Typical lead time"
                tooltip="Days from ordering until the material arrives. Used to estimate when a job's materials are ready."
                rules={[{ required: true, message: 'Enter the lead time in days' }]}
              >
                <InputNumber min={0} addonAfter="days" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={10} md={5}>
              <Form.Item
                name="active"
                label="Status"
                valuePropName="checked"
                tooltip="Inactive suppliers are hidden from new orders; their history is kept."
              >
                <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Contact')}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="contactPerson" label="Contact person">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="phone" label="Phone">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="email" label="Email">
                <Input type="email" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="address" label="Address">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="notes" label="Notes">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
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
