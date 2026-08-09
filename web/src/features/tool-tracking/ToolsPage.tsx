import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Modal, Form, Input, Typography, Space, Select } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { toolsApi } from '../../api/tools.api';
import StatusPill from '../../components/StatusPill';
import type { Tool } from '../../types';
import apiClient from '../../api/client';

type HolderFilter = 'all' | 'available' | 'in_use';
type SortKey = 'name_asc' | 'name_desc' | 'code_asc';

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [qrTool, setQrTool] = useState<Tool | null>(null);
  const [query, setQuery] = useState('');
  const [holderFilter, setHolderFilter] = useState<HolderFilter>('all');
  const [sort, setSort] = useState<SortKey>('name_asc');
  const [form] = Form.useForm();

  const fetchTools = async () => {
    setLoading(true);
    try {
      const { data } = await toolsApi.list();
      setTools(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tools.filter((t) => {
      if (q && !`${t.name} ${t.code}`.toLowerCase().includes(q)) return false;
      if (holderFilter === 'available' && t.custody) return false;
      if (holderFilter === 'in_use' && !t.custody) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'name_desc') return b.name.localeCompare(a.name);
      if (sort === 'code_asc') return a.code.localeCompare(b.code);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [tools, query, holderFilter, sort]);

  const onCreate = async (values: { name: string; code?: string }) => {
    await toolsApi.create(values);
    setModalOpen(false);
    form.resetFields();
    fetchTools();
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span>,
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      render: (c: string) => <span style={{ color: '#64748b', fontSize: 12 }}>{c}</span>,
    },
    {
      title: 'Current Holder',
      key: 'custody',
      render: (_: unknown, record: Tool) =>
        record.custody ? (
          <StatusPill color="amber">In Use · {record.custody.holderName}</StatusPill>
        ) : (
          <StatusPill color="green">Available</StatusPill>
        ),
    },
    {
      title: 'QR Code',
      key: 'qr',
      render: (_: unknown, record: Tool) => (
        <Button size="small" onClick={() => setQrTool(record)}>
          View QR
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Input
            allowClear
            placeholder="Search tools..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 220 }}
          />
          <Select
            value={holderFilter}
            onChange={setHolderFilter}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: 'All holders' },
              { value: 'available', label: 'Available' },
              { value: 'in_use', label: 'In use' },
            ]}
          />
          <Select
            value={sort}
            onChange={setSort}
            style={{ width: 150 }}
            options={[
              { value: 'name_asc', label: 'Name A–Z' },
              { value: 'name_desc', label: 'Name Z–A' },
              { value: 'code_asc', label: 'Code A–Z' },
            ]}
          />
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ height: 32, fontWeight: 600 }}
        >
          Add Tool
        </Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        locale={{ emptyText: 'No tools match your filters' }}
        scroll={{ x: true }}
      />

      <Modal title="Add Tool" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code (optional)">
            <Input placeholder="Auto-generated if empty" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      <Modal
        title={qrTool ? `QR: ${qrTool.name}` : 'QR Code'}
        open={Boolean(qrTool)}
        onCancel={() => setQrTool(null)}
        footer={null}
      >
        {qrTool && (
          <div style={{ textAlign: 'center' }}>
            <AuthenticatedQrImage toolId={qrTool.id} code={qrTool.code} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function AuthenticatedQrImage({ toolId, code }: { toolId: string; code: string }) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    apiClient
      .get(`/tools/${toolId}/qr`, { responseType: 'blob' })
      .then(({ data }) => setSrc(URL.createObjectURL(data)));
  }, [toolId]);

  return (
    <div>
      {src && <img src={src} alt={`QR for ${code}`} style={{ maxWidth: '100%' }} />}
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {code}
      </Typography.Text>
    </div>
  );
}
