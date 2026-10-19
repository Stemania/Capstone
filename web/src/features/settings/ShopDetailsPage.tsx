import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Spin,
  message,
} from 'antd';
import { EyeOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { shopDetailsApi, type ShopDetails } from '../../api/shopDetails.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import type { NotificationLog } from '../../types';
import { invalidateShopDetails } from '../../hooks/useShopDetails';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { usePageHeaderActions } from '../../layouts/pageHeaderActions';
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

function SectionRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="shop-details-page__section">
      <div className="shop-details-page__section-meta">
        <h2 className="shop-details-page__section-title">{title}</h2>
        <p className="shop-details-page__section-hint">{hint}</p>
      </div>
      <div className="shop-details-page__section-fields">{children}</div>
    </section>
  );
}

function LetterheadPreviewSheet({ values }: { values: Partial<ShopDetails> }) {
  const preview = shopLetterheadPreview(values);

  return (
    <div className="shop-details-preview__sheet" data-testid="letterhead-preview-sheet">
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
        <div className="shop-details-preview__sigs shop-print-signatures">
          <div className="shop-print-signature">
            <div>Approved by: (PO)</div>
            <div className="shop-print-signature__space" />
            <div className="shop-print-signature__name">{preview.poApproverName}</div>
            <div>{preview.poApproverTitle}</div>
          </div>
          <div className="shop-print-signature">
            <div>Approved by: (JO)</div>
            <div className="shop-print-signature__space" />
            <div className="shop-print-signature__name">{preview.joApproverName}</div>
            <div>{preview.joApproverTitle}</div>
          </div>
        </div>
      </div>
    </div>
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const watched = Form.useWatch([], form) as Partial<ShopDetails> | undefined;

  const dirty = useMemo(() => {
    if (!baseline || !watched) return false;
    return (Object.keys(EMPTY) as (keyof ShopDetails)[]).some(
      (k) => String(watched[k] ?? '') !== String(baseline[k] ?? '')
    );
  }, [baseline, watched]);

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

  const headerActions = useMemo(
    () => (
      <>
        <span className="app-topbar__page-actions-note">
          {updatedAt ? `Last saved ${formatShop(updatedAt, 'MMM D, YYYY h:mm A')}` : ''}
        </span>
        <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
          Preview letterhead
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty || loading}
          onClick={() => form.submit()}
        >
          Save
        </Button>
      </>
    ),
    [dirty, form, loading, saving, updatedAt]
  );

  usePageHeaderActions(loading ? null : headerActions);

  if (loading) {
    return (
      <div className="page-spinner">
        <Spin />
      </div>
    );
  }

  return (
    <div className="shop-details-page">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}

      <Form
        form={form}
        layout="vertical"
        onFinish={onSave}
        requiredMark="optional"
        className="shop-details-page__form"
      >
        <SectionRow
          title="Letterhead"
          hint="Shop identity at the top of every printed document."
        >
          <Form.Item
            name="shopName"
            label="Shop name"
            rules={[{ required: true, message: 'Shop name is required' }]}
            extra="Full legal or trading name as it should appear in print."
          >
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="tagline" label="Tagline" extra="Optional. Shown under the shop name.">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 3 }} maxLength={500} />
          </Form.Item>
          <Form.Item
            name="address"
            label="Address"
            rules={[{ required: true, message: 'Address is required' }]}
          >
            <Input maxLength={500} />
          </Form.Item>
        </SectionRow>

        <SectionRow title="Contact" hint="Printed under the letterhead on every shop document.">
          <div className="shop-details-page__phone-row">
            <Form.Item name="telephone" label="Telephone">
              <Input maxLength={100} placeholder="(043) 4303524" />
            </Form.Item>
            <Form.Item name="mobileNumbers" label="Mobile numbers">
              <Input maxLength={200} placeholder="0926… / 0915…" />
            </Form.Item>
          </div>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Enter a valid email' }]}>
            <Input maxLength={255} placeholder="shop@example.com" />
          </Form.Item>
        </SectionRow>

        <SectionRow
          title="Approvers"
          hint="Names and titles on the signature lines of printed documents."
        >
          <div className="shop-details-page__approver-grid" role="group" aria-label="Purchase order approver">
            <div className="shop-details-page__approver-doc">Purchase orders</div>
            <Form.Item name="poApproverName" label="Name">
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item name="poApproverTitle" label="Title">
              <Input maxLength={255} />
            </Form.Item>
          </div>
          <div className="shop-details-page__approver-grid" role="group" aria-label="Job order approver">
            <div className="shop-details-page__approver-doc">Job orders</div>
            <Form.Item name="joApproverName" label="Name">
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item name="joApproverTitle" label="Title">
              <Input maxLength={255} />
            </Form.Item>
          </div>
        </SectionRow>

        <TestEmailSection />
      </Form>

      <Modal
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        title="Letterhead preview"
        footer={
          <Button type="primary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        }
        width={560}
        destroyOnHidden
        className="shop-details-preview-modal"
      >
        <p className="shop-details-preview__caption">
          Matches the header printed on purchase orders and job orders
          {dirty ? ' (includes unsaved edits)' : ''}.
        </p>
        <LetterheadPreviewSheet values={watched || {}} />
      </Modal>
    </div>
  );
}

function TestEmailSection() {
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
    <SectionRow
      title="Test email"
      hint="Sends one message through the configured email backend so you can confirm delivery."
    >
      <div className="shop-details-page__test-row">
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          onPressEnter={send}
          aria-label="Test email recipient"
        />
        <Button type="default" icon={<SendOutlined />} loading={sending} onClick={send}>
          Send test
        </Button>
      </div>
      {result ? (
        <Alert
          className="shop-details-page__test-result"
          type={result.status === 'SENT' ? 'success' : 'warning'}
          showIcon
          title={`${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ''}`}
        />
      ) : null}
    </SectionRow>
  );
}
