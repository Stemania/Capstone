import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Typography, Tag, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { toolsApi } from '../../api/tools.api';
import type { Tool } from '../../types';
import apiClient from '../../api/client';

const { Title } = Typography;

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [qrTool, setQrTool] = useState<Tool | null>(null);
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

  const onCreate = async (values: { name: string; code?: string }) => {
    await toolsApi.create(values);
    setModalOpen(false);
    form.resetFields();
    fetchTools();
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Code', dataIndex: 'code', key: 'code' },
    {
      title: 'Current Holder',
      key: 'custody',
      render: (_: unknown, record: Tool) =>
        record.custody ? (
          <Tag color="orange">{record.custody.holderName}</Tag>
        ) : (
          <Tag color="green">Available</Tag>
        ),
    },
    {
      title: 'QR Code',
      key: 'qr',
      render: (_: unknown, record: Tool) => (
        <Button size="small" onClick={() => setQrTool(record)}>View QR</Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>Tools</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Add Tool
        </Button>
      </Space>

      <Table rowKey="id" columns={columns} dataSource={tools} loading={loading} scroll={{ x: true }} />

      <Modal title="Add Tool" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code (optional)">
            <Input placeholder="Auto-generated if empty" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Create</Button>
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
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>{code}</Typography.Text>
    </div>
  );
}
