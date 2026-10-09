import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Row, Spin, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { shopDetailsApi, type ShopDetails } from '../../api/shopDetails.api';
import { getErrorMessage } from '../../api/client';
import { invalidateShopDetails } from '../../hooks/useShopDetails';
import { formatShop } from '../../utils/shopTime';

function sectionLabel(text: string) {
  return <div className="app-form-section">{text}</div>;
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
    <div style={{ maxWidth: 880 }}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Card style={{ borderRadius: 12 }}>
        <Form form={form} layout="vertical" onFinish={onSave} requiredMark="optional">
          {sectionLabel('Letterhead')}
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item name="shopName" label="Shop name" rules={[{ required: true }]}>
                <Input maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24}>
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
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="telephone" label="Telephone">
                <Input maxLength={100} placeholder="(043) 4303524" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="mobileNumbers" label="Mobile numbers">
                <Input maxLength={200} placeholder="0926… / 0915…" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input maxLength={255} />
              </Form.Item>
            </Col>
          </Row>

          {sectionLabel('Approvers')}
          <Row gutter={16}>
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: '#64748b' }}>
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
    </div>
  );
}
