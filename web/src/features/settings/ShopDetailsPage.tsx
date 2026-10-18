import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Spin,
  message,
} from 'antd';
import { SaveOutlined, SendOutlined } from '@ant-design/icons';
import { shopDetailsApi, type ShopDetails } from '../../api/shopDetails.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import type { NotificationLog } from '../../types';
import { invalidateShopDetails } from '../../hooks/useShopDetails';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { formatShop } from '../../utils/shopTime';
import { shopLetterheadPreview } from './shopLetterheadPreview';
import './shopDetails.css';

const EMPTY: ShopDetails = {
  shopName: '',
  tagline: '',
  address: '',
  telephone: '',
  mobileNumbers: '',
  email: '',
  poApproverName: '',
  poApproverTitle: '',
  joApproverName: '',
  joApproverTitle: '',
};

function Section({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="shop-details-page__section">
      <div className="shop-details-page__section-title">{title}</div>
      <p className="shop-details-page__section-hint">{hint}</p>
    </div>
  );
}

function LetterheadPreview({ values }: { values: Partial<ShopDetails> }) {
  const preview = shopLetterheadPreview(values);

  return (
    <aside className="shop-details-preview" aria-label="Letterhead preview">
      <div className="shop-details-preview__title">Letterhead preview</div>
      <div className="shop-details-preview__sheet">
        <header className="shop-print-header shop-details-preview__header">
          <div className="shop-print-header__row">
            <img className="shop-print-logo" src="/logo.png" alt="" />
            <div className="shop-print-header__text">
              <div className="shop-print-name">{preview.shopName}</div>
              {preview.tagline ? (
                <div className="shop-print-tagline">{preview.tagline}</div>
              ) : null}
            </div>
          </div>
          <div className="shop-print-bar" aria-hidden>
            {(['gold', 'black', 'gold', 'black'] as const).map((tone, i) => (
              <span key={i} className={`shop-print-bar__seg shop-print-bar__seg--${tone}`} />
            ))}
          </div>
        </header>
        <div className="shop-details-preview__body">
          {preview.address ? (
            <div className="shop-details-preview__address">{preview.address}</div>
          ) : null}
          {preview.contacts.length ? (
            <div className="shop-details-preview__contacts">
              {preview.contacts.map((c, i) => (
                <span key={c}>
                  {i > 0 ? <span className="shop-print-sep"> - </span> : null}
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <div className="shop-details-preview__sigs">
            <div className="shop-print-signature">
              <div className="shop-print-signature__space" />
              <div className="shop-print-signature__name">{preview.poApproverName}</div>
              <div className="shop-print-signature__title">{preview.poApproverTitle}</div>
            </div>
            <div className="shop-print-signature">
              <div className="shop-print-signature__space" />
              <div className="shop-print-signature__name">{preview.joApproverName}</div>
              <div className="shop-print-signature__title">{preview.joApproverTitle}</div>
            </div>
          </div>
        </div>
      </div>
      <p className="shop-details-preview__caption">
        Matches the header printed on purchase orders and job orders.
      </p>
    </aside>
  );
}

/** Admin-editable shop details printed on purchase orders and job orders. */
export default function ShopDetailsPage() {
  const [form] = Form.useForm<ShopDetails>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ShopDetails | null>(null);
  const watched = Form.useWatch([], form) as Partial<ShopDetails> | undefined;

  const dirty = useMemo(() => {
    if (!baseline || !watched) return false;
    return (Object.keys(EMPTY) as (keyof ShopDetails)[]).some(
      (k) => String(watched[k] ?? '') !== String(baseline[k] ?? '')
    );
  }, [baseline, watched]);

  // BrowserRouter cannot use useBlocker (needs a data router).
  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    shopDetailsApi
      .get()
      .then(({ data }) => {
        form.setFieldsValue(data);
        setBaseline(data);
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
      setBaseline(data);
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
        <Form
          form={form}
          layout="vertical"
          onFinish={onSave}
          requiredMark="optional"
          className="shop-details-page__form"
        >
          <div className="shop-details-page__layout">
            <div className="shop-details-page__fields">
              <div className="shop-details-page__block">
                <Section
                  title="Letterhead"
                  hint="Shown at the top of printed purchase orders and job orders."
                />
                <Form.Item name="shopName" label="Shop name" rules={[{ required: true }]}>
                  <Input maxLength={255} />
                </Form.Item>
                <Form.Item name="tagline" label="Tagline">
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 3 }} maxLength={500} />
                </Form.Item>
                <Form.Item name="address" label="Address" rules={[{ required: true }]}>
                  <Input maxLength={500} />
                </Form.Item>
              </div>

              <div className="shop-details-page__block">
                <Section title="Contact" hint="Printed under the letterhead on every shop document." />
                <div className="shop-details-page__contact-row">
                  <Form.Item name="telephone" label="Telephone">
                    <Input maxLength={100} placeholder="(043) 4303524" />
                  </Form.Item>
                  <Form.Item name="mobileNumbers" label="Mobile numbers">
                    <Input maxLength={200} placeholder="0926… / 0915…" />
                  </Form.Item>
                </div>
                <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                  <Input maxLength={255} />
                </Form.Item>
              </div>

              <div className="shop-details-page__block">
                <Section
                  title="Approvers"
                  hint="Signature lines on printed purchase orders and job orders."
                />
                <div className="shop-details-page__approver-row">
                  <Form.Item name="poApproverName" label="Purchase order approver">
                    <Input maxLength={255} />
                  </Form.Item>
                  <Form.Item name="poApproverTitle" label="Title">
                    <Input maxLength={255} />
                  </Form.Item>
                </div>
                <div className="shop-details-page__approver-row">
                  <Form.Item name="joApproverName" label="Job order approver">
                    <Input maxLength={255} />
                  </Form.Item>
                  <Form.Item name="joApproverTitle" label="Title">
                    <Input maxLength={255} />
                  </Form.Item>
                </div>
              </div>
            </div>

            <LetterheadPreview values={watched || {}} />
          </div>

          <div className="shop-details-page__save m-action-bar">
            <span className="shop-details-page__save-note m-action-bar__note">
              {updatedAt ? `Last saved ${formatShop(updatedAt, 'MMM D, YYYY h:mm A')}` : ''}
            </span>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty}
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

  const send = async () => {
    try {
      setSending(true);
      setResult(null);
      const { data } = await notificationsApi.sendTest('email', to.trim());
      setResult(data);
      message.success(data.status === 'SENT' ? 'Test email sent' : 'Logged (check status)');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="shop-details-page__card" style={{ borderRadius: 12 }} title="Test email">
      <p className="shop-details-page__email-lead">
        Sends one message through the configured email backend so you can confirm delivery.
      </p>
      <Row gutter={12} align="middle">
        <Col flex="auto">
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
            onPressEnter={send}
          />
        </Col>
        <Col>
          <Button type="default" icon={<SendOutlined />} loading={sending} onClick={send}>
            Send test
          </Button>
        </Col>
      </Row>
      {result ? (
        <Alert
          style={{ marginTop: 12 }}
          type={result.status === 'SENT' ? 'success' : 'warning'}
          showIcon
          title={`${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ''}`}
        />
      ) : null}
    </Card>
  );
}
