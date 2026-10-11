import { useEffect, useState } from 'react';
import { Button, Col, Form, Input, Modal, Row, Switch, message } from 'antd';
import { ContactsOutlined } from '@ant-design/icons';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { Client } from '../../types';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
}

/** Register a client, or edit one when `client` is set. */
export default function ClientFormModal({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onSaved: (saved: Client) => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      form.setFieldsValue({
        name: client.name,
        contact: client.contact,
        email: client.email,
        mobileNumber: client.mobileNumber,
        notifyByEmail: !!client.notifyByEmail,
        notifyBySms: !!client.notifyBySms,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ notifyByEmail: false, notifyBySms: false });
    }
  }, [open, client, form]);

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
      if (client) {
        const { data } = await clientsApi.update(client.id, payload);
        message.success('Client updated');
        onSaved(data);
      } else {
        const { data } = await clientsApi.create(payload);
        message.success('Client registered');
        onSaved(data);
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      centered
      forceRender
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
          <div className="app-form-modal__title">{client ? 'Edit client' : 'Register client'}</div>
          <div className="app-form-modal__sub">
            {client
              ? 'Update contact details and how they get job updates.'
              : 'Company or person, plus how they should get job updates.'}
          </div>
        </div>
        <button type="button" className="app-form-modal__close" onClick={onClose} aria-label="Close">
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
          <Col xs={24} sm={14}>
            <Form.Item
              name="email"
              label="Email"
              rules={[{ type: 'email', message: 'Enter a valid email' }]}
              style={{ marginBottom: 14 }}
            >
              <Input placeholder="client@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
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
        <Button onClick={onClose} style={{ minWidth: 96 }}>
          Cancel
        </Button>
        <Button type="primary" loading={saving} onClick={onSave} style={{ fontWeight: 700, minWidth: 120 }}>
          {client ? 'Save' : 'Register'}
        </Button>
      </div>
    </Modal>
  );
}
