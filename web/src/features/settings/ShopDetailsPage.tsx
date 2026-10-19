import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Grid,
  Input,
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

function Section({
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
      <header className="shop-details-page__section-head">
        <h2 className="shop-details-page__section-title">{title}</h2>
        <p className="shop-details-page__section-hint">{hint}</p>
      </header>
      <div className="shop-details-page__section-body">{children}</div>
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

function PreviewPanel({
  values,
  dirty,
}: {
  values: Partial<ShopDetails>;
  dirty: boolean;
}) {
  return (
    <aside className="shop-details-page__preview" aria-label="Letterhead preview">
      <div className="shop-details-page__preview-head">
        <h2 className="shop-details-page__preview-title">Letterhead preview</h2>
        <p className="shop-details-page__preview-caption">
          As printed on purchase orders and job orders
          {dirty ? ' · includes unsaved edits' : ''}.
        </p>
      </div>
      <LetterheadPreviewSheet values={values} />
    </aside>
  );
}

/** Admin-editable shop details printed on purchase orders and job orders. */
export default function ShopDetailsPage() {
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.lg;
  const [form] = Form.useForm<ShopDetails>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ShopDetails | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const watched = Form.useWatch([], form) as Partial<ShopDetails> | undefined;

  const dirty = useMemo(() => {
    if (!baseline || !watched) return false;
    return (Object.keys(EMPTY) as (keyof ShopDetails)[]).some(
      (k) => String(watched[k] ?? '') !== String(baseline[k] ?? '')
    );
  }, [baseline, watched]);

  useUnsavedChangesWarning(dirty);
  // Keep the app topbar free — Save lives with the form.
  usePageHeaderActions(null);

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

  const previewValues = watched || {};

  return (
    <div className="shop-details-page">
      {error ? <Alert type="error" showIcon title={error} className="shop-details-page__alert" /> : null}

      <div className="shop-details-page__workspace">
        <div className="shop-details-page__main">
          <Form
            form={form}
            layout="vertical"
            onFinish={onSave}
            requiredMark="optional"
            className="shop-details-page__form"
          >
            <div className="shop-details-page__panel">
              <Section
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
                <Form.Item
                  name="tagline"
                  label="Tagline"
                  extra="Optional. Shown under the shop name."
                >
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 3 }} maxLength={500} />
                </Form.Item>
                <Form.Item
                  name="address"
                  label="Address"
                  rules={[{ required: true, message: 'Address is required' }]}
                >
                  <Input maxLength={500} />
                </Form.Item>
              </Section>

              <Section title="Contact" hint="Printed under the letterhead on every shop document.">
                <div className="shop-details-page__field-pair">
                  <Form.Item name="telephone" label="Telephone">
                    <Input maxLength={100} placeholder="(043) 4303524" />
                  </Form.Item>
                  <Form.Item name="mobileNumbers" label="Mobile numbers">
                    <Input maxLength={200} placeholder="0926… / 0915…" />
                  </Form.Item>
                </div>
                <Form.Item
                  name="email"
                  label="Email"
                  rules={[{ type: 'email', message: 'Enter a valid email' }]}
                >
                  <Input maxLength={255} placeholder="shop@example.com" className="shop-details-page__email" />
                </Form.Item>
              </Section>

              <Section
                title="Approvers"
                hint="Names and titles on the signature lines of printed documents."
              >
                <div className="shop-details-page__approver-cards">
                  <div
                    className="shop-details-page__approver-card"
                    role="group"
                    aria-label="Purchase order approver"
                  >
                    <div className="shop-details-page__approver-card-title">Purchase orders</div>
                    <Form.Item name="poApproverName" label="Name">
                      <Input maxLength={255} />
                    </Form.Item>
                    <Form.Item name="poApproverTitle" label="Title" className="shop-details-page__mb-0">
                      <Input maxLength={255} />
                    </Form.Item>
                  </div>
                  <div
                    className="shop-details-page__approver-card"
                    role="group"
                    aria-label="Job order approver"
                  >
                    <div className="shop-details-page__approver-card-title">Job orders</div>
                    <Form.Item name="joApproverName" label="Name">
                      <Input maxLength={255} />
                    </Form.Item>
                    <Form.Item name="joApproverTitle" label="Title" className="shop-details-page__mb-0">
                      <Input maxLength={255} />
                    </Form.Item>
                  </div>
                </div>
              </Section>
            </div>

            <div className="shop-details-page__panel shop-details-page__panel--muted">
              <Section
                title="Test email"
                hint="Send one message through the configured email backend to confirm delivery."
              >
                <div className="shop-details-page__test-row">
                  <TestEmailFields />
                </div>
              </Section>
            </div>

            <div className="shop-details-page__footer">
              <span className="shop-details-page__footer-note">
                {updatedAt ? `Last saved ${formatShop(updatedAt, 'MMM D, YYYY h:mm A')}` : ''}
              </span>
              <div className="shop-details-page__footer-actions">
                {isNarrow ? (
                  <Button icon={<EyeOutlined />} onClick={() => setDrawerOpen(true)}>
                    Preview letterhead
                  </Button>
                ) : null}
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!dirty}
                >
                  Save
                </Button>
              </div>
            </div>
          </Form>
        </div>

        {!isNarrow ? <PreviewPanel values={previewValues} dirty={dirty} /> : null}
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Letterhead preview"
        size="large"
        destroyOnHidden
        className="shop-details-preview-drawer"
      >
        <p className="shop-details-page__preview-caption shop-details-page__preview-caption--drawer">
          As printed on purchase orders and job orders
          {dirty ? ' · includes unsaved edits' : ''}.
        </p>
        <LetterheadPreviewSheet values={previewValues} />
      </Drawer>
    </div>
  );
}

function TestEmailFields() {
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
    <>
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
      {result ? (
        <Alert
          className="shop-details-page__test-result"
          type={result.status === 'SENT' ? 'success' : 'warning'}
          showIcon
          title={`${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ''}`}
        />
      ) : null}
    </>
  );
}
