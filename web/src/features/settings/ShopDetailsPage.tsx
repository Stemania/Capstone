import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Row, Space, Spin, message } from 'antd';
import { SaveOutlined, SendOutlined } from '@ant-design/icons';
import { shopDetailsApi, type ShopDetails } from '../../api/shopDetails.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import type { NotificationLog } from '../../types';
import { invalidateShopDetails } from '../../hooks/useShopDetails';
import { formatShop } from '../../utils/shopTime';
import './shopDetails.css';

function sectionLabel(text: string) {
  return <div className="shop-details-page__section">{text}</div>;
}

/** Admin-editable shop details printed on purchase orders and job orders. */
export default function ShopDetailsPage() {
  const [form] = Form.useForm<ShopDetails>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    shopDetailsApi
      .get()
      .then(({ data }) => {
        form.setFieldsValue(data);
        setUpdatedAt(data.updatedAt ?? null);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [form]);

  const onSave = async (values: ShopDetails) => {
    try {
      setSaving(true);
      const { data } = await shopDetailsApi.update(values);
      form.setFieldsValue(data);
      setUpdatedAt(data.updatedAt ?? null);
      invalidateShopDetails();
      message.success('Shop details saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <Spin />
      </div>
    );
  }

  return (
    <div className="shop-details-page">
      {error && <Alert type="error" showIcon title={error} />}
      <Card className="shop-details-page__card" style={{ borderRadius: 12 }}>
        <Form form={form} layout="vertical" onFinish={onSave} requiredMark="optional">
          {sectionLabel('Letterhead')}
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="shopName" label="Shop name" rules={[{ required: true }]}>
                <Input maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tagline" label="Tagline">
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="address" label="Address" rules={[{ required: true }]}>
                <Input maxLength={500} />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Contact')}
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="telephone" label="Telephone">
                <Input maxLength={100} placeholder="(043) 4303524" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="mobileNumbers" label="Mobile numbers">
                <Input maxLength={200} placeholder="0926… / 0915…" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input maxLength={255} />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Approvers')}
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="poApproverName" label="Purchase order approver">
                <Input maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="poApproverTitle" label="Title">
                <Input maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="joApproverName" label="Job order approver">
                <Input maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="joApproverTitle" label="Title">
                <Input maxLength={255} />
              </Form.Item>
            </Col>
          </Row>

          <div className="shop-details-page__save m-action-bar">
            <span className="shop-details-page__save-note m-action-bar__note">
              {updatedAt ? `Last saved ${formatShop(updatedAt, 'MMM D, YYYY h:mm A')}` : ''}
            </span>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              style={{ fontWeight: 700, minWidth: 120 }}
            >
              Save
            </Button>
          </div>
        </Form>
      </Card>
      <TestEmailCard />
    </div>
  );
}

function TestEmailCard() {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<NotificationLog | null>(null);

  const onSend = async () => {
    try {
      setSending(true);
      setResult(null);
      const { data } = await notificationsApi.sendTest('email', to.trim());
      setResult(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="shop-details-page__card" style={{ borderRadius: 12 }}>
      {sectionLabel('Email notifications')}
      <p className="shop-details-page__email-lead">
        Send one test email to check the email setup. It is only delivered when notifications are
        turned on and the address is allowed.
      </p>
      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input
          type="email"
          placeholder="name@example.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onPressEnter={() => to.trim() && onSend()}
          maxLength={255}
        />
        <Button icon={<SendOutlined />} loading={sending} disabled={!to.trim()} onClick={onSend}>
          Send test email
        </Button>
      </Space.Compact>
      {result && (
        <Alert
          style={{ marginTop: 12 }}
          showIcon
          type={result.status === 'SENT' ? 'success' : result.status === 'FAILED' ? 'error' : 'warning'}
          title={
            result.status === 'SENT'
              ? `Sent to ${result.recipient}`
              : result.status === 'FAILED'
                ? result.errorMessage || 'Send failed'
                : result.status
          }
        />
      )}
    </Card>
  );
}
