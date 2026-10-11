import { Button, Form, Input, Modal, Skeleton, message } from 'antd';
import {
  CheckCircleFilled,
  DesktopOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LockOutlined,
  MobileOutlined,
  TabletOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getOrCreateDeviceId } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { Page, SectionCard, StatusPill } from '../../components/ui';
import { PersonAvatar } from '../../components/PersonAvatar';
import { formatShop, shopNow, toShopDayjs } from '../../utils/shopTime';
import type { UserDevice } from '../../types';
import PinSetupKeypad from './PinSetupKeypad';
import './AccountSecurityPage.css';

/** Other devices listed before "Show N more". */
const VISIBLE_OTHERS = 3;

type DeviceKind = 'phone' | 'tablet' | 'desktop';

type DeviceInfo = { name: string; kind: DeviceKind };

function describeDevice(label: string | null | undefined, deviceId: string): DeviceInfo {
  const raw = (label || '').trim();
  if (!raw) return { name: `Device ${deviceId.slice(0, 8)}`, kind: 'desktop' };

  let kind: DeviceKind = 'desktop';
  if (/iPad|Tablet/.test(raw) || (/Android/.test(raw) && !/Mobile/.test(raw))) kind = 'tablet';
  else if (/iPhone|iPod|Android|Mobile/.test(raw)) kind = 'phone';

  if (!raw.includes('Mozilla') && raw.length <= 48) return { name: raw, kind };

  let os = 'Device';
  if (/iPhone|iPod/.test(raw)) os = 'iPhone';
  else if (/iPad/.test(raw)) os = 'iPad';
  else if (/Android/.test(raw)) os = 'Android';
  else if (/Windows/.test(raw)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(raw)) os = 'Mac';
  else if (/Linux/.test(raw)) os = 'Linux';

  const version = (token: string) => raw.match(new RegExp(`${token}/(\\d+)`))?.[1];
  let browser = '';
  if (/Edg(A|iOS)?\//.test(raw)) browser = `Edge ${version('Edg(?:A|iOS)?') ?? ''}`;
  else if (/Cursor\//.test(raw)) browser = 'Cursor browser';
  else if (/CriOS\//.test(raw)) browser = `Chrome ${version('CriOS') ?? ''}`;
  else if (/Firefox\//.test(raw)) browser = `Firefox ${version('Firefox') ?? ''}`;
  else if (/Chrome\//.test(raw)) browser = `Chrome ${version('Chrome') ?? ''}`;
  else if (/Safari\//.test(raw)) browser = `Safari ${version('Version') ?? ''}`;

  return { name: browser ? `${os} · ${browser.trim()}` : os, kind };
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = toShopDayjs(iso);
  if (!then.isValid()) return 'never';
  const now = shopNow();
  const mins = now.diff(then, 'minute');
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = now.diff(then, 'hour');
  if (hours < 24) return `${hours} h ago`;
  const days = now.diff(then, 'day');
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatShop(iso, then.year() === now.year() ? 'MMM D' : 'MMM D, YYYY');
}

function lastActive(d: UserDevice): string {
  return d.lastUsedAt || d.createdAt || '';
}

/** Server rules: 8+ characters, not only letters, not only numbers. */
function passwordRules(pw: string) {
  const long = pw.length >= 8;
  const mixed = pw.length > 0 && !/^\d+$/.test(pw) && !/^\p{L}+$/u.test(pw);
  let strength: 'empty' | 'weak' | 'okay' | 'strong' = 'empty';
  if (pw) {
    if (!long || !mixed) strength = 'weak';
    else if (pw.length >= 12 && ((/[A-Z]/.test(pw) && /[a-z]/.test(pw)) || /[^\p{L}\d]/u.test(pw))) {
      strength = 'strong';
    } else strength = 'okay';
  }
  return { long, mixed, strength };
}

const STRENGTH_LABEL = {
  empty: '',
  weak: 'Too weak',
  okay: 'Okay',
  strong: 'Strong',
} as const;

const KIND_ICON: Record<DeviceKind, ReactNode> = {
  phone: <MobileOutlined />,
  tablet: <TabletOutlined />,
  desktop: <DesktopOutlined />,
};

function DeviceRow({
  device,
  current,
  onRemove,
}: {
  device: UserDevice;
  current: boolean;
  onRemove?: () => void;
}) {
  const info = describeDevice(device.deviceLabel, device.deviceId);
  const last = lastActive(device);
  return (
    <li className={`sec-device${current ? ' sec-device--current' : ''}`}>
      <span className="sec-device__icon" aria-hidden>
        {KIND_ICON[info.kind]}
      </span>
      <div className="sec-device__main">
        <div className="sec-device__name-row">
          <span className="sec-device__name">{info.name}</span>
          {current ? (
            <StatusPill tone="blue" compact>
              This device
            </StatusPill>
          ) : null}
          {device.hasPin ? (
            <StatusPill tone="green" compact>
              PIN on
            </StatusPill>
          ) : null}
        </div>
        <div className="sec-device__meta">
          <span title={last ? formatShop(last, 'MMM D, YYYY h:mm A') : undefined}>
            {current ? 'Active now' : `Last active ${timeAgo(last)}`}
          </span>
          <span title={formatShop(device.createdAt, 'MMM D, YYYY h:mm A')}>
            First signed in {formatShop(device.createdAt, 'MMM D, YYYY')}
          </span>
          {device.hasPin ? null : <span>PIN off</span>}
          <span className="sec-device__id" title="Device ID (stored in that browser)">
            ID {device.deviceId.slice(-4).toUpperCase()}
          </span>
        </div>
      </div>
      {onRemove ? (
        <Button type="text" className="sec-device__remove" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </li>
  );
}

export default function AccountSecurityPage() {
  const navigate = useNavigate();
  const { user, isWorker } = useAuth();
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [passwordForm] = Form.useForm();
  const newPassword: string = Form.useWatch('newPassword', passwordForm) || '';
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const deviceId = getOrCreateDeviceId();
  const deviceWord = isWorker ? 'phone' : 'device';
  const [modal, modalHolder] = Modal.useModal();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await authApi.listDevices();
      setDevices(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const thisDevice = devices.find((d) => d.deviceId === deviceId && !d.revokedAt);
  const others = useMemo(
    () =>
      devices
        .filter((d) => !d.revokedAt && d.deviceId !== deviceId)
        .sort((a, b) => lastActive(b).localeCompare(lastActive(a))),
    [devices, deviceId]
  );
  const visibleOthers = showAll ? others : others.slice(0, VISIBLE_OTHERS);
  const hiddenCount = others.length - visibleOthers.length;
  const rules = passwordRules(newPassword);

  const onSavePin = async (pin: string) => {
    await authApi.setPin(pin);
    localStorage.setItem('bmsc_has_pin', '1');
    message.success(`PIN saved. Use it next time you open the app on this ${deviceWord}.`);
    setPinModalOpen(false);
    load();
  };

  const onRemovePin = () => {
    modal.confirm({
      title: 'Turn off PIN unlock?',
      content: `You will sign in with your password on this ${deviceWord}.`,
      okText: 'Turn off PIN',
      cancelText: 'Keep PIN',
      centered: true,
      onOk: async () => {
        try {
          await authApi.removePin();
          localStorage.removeItem('bmsc_has_pin');
          message.success('PIN unlock turned off');
          load();
        } catch (err) {
          message.error(getErrorMessage(err));
        }
      },
    });
  };

  const onChangePassword = async (values: { currentPassword: string; newPassword: string }) => {
    setPasswordSaving(true);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      localStorage.removeItem('bmsc_has_pin');
      message.success('Password updated. PIN unlock is now off on all your devices.');
      passwordForm.resetFields();
      load();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  };

  const removeNote =
    'PIN unlock stops working there and it leaves this list. If that browser is still signed in, ' +
    'it stays signed in until its session ends (at most 7 days).';

  const removeOne = (row: UserDevice) => {
    modal.confirm({
      title: `Remove ${describeDevice(row.deviceLabel, row.deviceId).name}?`,
      content: removeNote,
      okText: 'Remove',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          await authApi.revokeDevice(row.id);
          message.success('Device removed');
          load();
        } catch (err) {
          message.error(getErrorMessage(err));
        }
      },
    });
  };

  const removeOthers = () => {
    modal.confirm({
      title: `Remove all ${others.length} other device${others.length === 1 ? '' : 's'}?`,
      content: `${removeNote} This ${deviceWord} is not affected.`,
      okText: 'Remove all others',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        const results = await Promise.allSettled(others.map((d) => authApi.revokeDevice(d.id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed)
          message.warning(`${failed} device${failed === 1 ? '' : 's'} could not be removed. Try again.`);
        else message.success('Other devices removed');
        setShowAll(false);
        load();
      },
    });
  };

  const passwordCard = (
    <SectionCard
      key="password"
      className="sec-card"
      title={
        <span className="sec-card__title">
          <span className="sec-card__icon sec-card__icon--password" aria-hidden>
            <LockOutlined />
          </span>
          Password
        </span>
      }
      subtitle="Change the password you use to sign in."
    >
      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={onChangePassword}
        requiredMark={false}
        className="sec-form"
      >
        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Enter your current password' }]}
        >
          <Input.Password size="large" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New password"
          rules={[
            { required: true, message: 'Enter a new password' },
            {
              validator: (_, v: string) => {
                if (!v) return Promise.resolve();
                const r = passwordRules(v);
                if (!r.long) return Promise.reject(new Error('Use at least 8 characters'));
                if (!r.mixed) return Promise.reject(new Error('Mix letters with numbers or symbols'));
                return Promise.resolve();
              },
            },
          ]}
          extra={
            <div className="sec-strength" aria-live="polite">
              <div className={`sec-strength__bar sec-strength__bar--${rules.strength}`} aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <ul className="sec-rules">
                <li className={rules.long ? 'is-met' : undefined}>
                  <CheckCircleFilled aria-hidden /> 8+ characters
                </li>
                <li className={rules.mixed ? 'is-met' : undefined}>
                  <CheckCircleFilled aria-hidden /> Letters and numbers
                </li>
                {rules.strength !== 'empty' ? (
                  <li className={`sec-strength__label sec-strength__label--${rules.strength}`}>
                    {STRENGTH_LABEL[rules.strength]}
                  </li>
                ) : null}
              </ul>
            </div>
          }
        >
          <Input.Password size="large" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="Confirm new password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Type the new password again' },
            ({ getFieldValue }) => ({
              validator: (_, v: string) =>
                !v || v === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('Passwords do not match')),
            }),
          ]}
        >
          <Input.Password size="large" autoComplete="new-password" />
        </Form.Item>
        <p className="sec-note">
          <InfoCircleOutlined aria-hidden />
          Changing your password turns off PIN unlock on all your devices.
        </p>
        <Button type="primary" htmlType="submit" size="large" loading={passwordSaving} className="sec-btn">
          Update password
        </Button>
      </Form>
    </SectionCard>
  );

  const pinOn = Boolean(thisDevice?.hasPin);
  const pinCard = (
    <SectionCard
      key="pin"
      className="sec-card"
      title={
        <span className="sec-card__title">
          <span className="sec-card__icon sec-card__icon--pin" aria-hidden>
            <KeyOutlined />
          </span>
          Quick unlock PIN
          {loading ? null : (
            <StatusPill tone={pinOn ? 'green' : 'slate'} compact dot>
              {pinOn ? 'On' : 'Off'}
            </StatusPill>
          )}
        </span>
      }
      subtitle={`Open the app with 6 numbers instead of your password, on this ${deviceWord} only.`}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : !thisDevice ? (
        <p className="sec-pin__blocked">
          To set up a PIN, log out and sign in again with your password on this {deviceWord}.
        </p>
      ) : pinOn ? (
        <div className="sec-pin">
          <p className="sec-pin__on">
            <CheckCircleFilled aria-hidden />
            <span>
              PIN is on for this {deviceWord}
              {thisDevice.pinSetAt ? ` since ${formatShop(thisDevice.pinSetAt, 'MMM D, YYYY')}` : ''}.
              <span className="sec-pin__sub"> Forgot it? Sign in with your password.</span>
            </span>
          </p>
          <div className="sec-pin__actions">
            <Button size="large" className="sec-btn" onClick={() => setPinModalOpen(true)}>
              Change PIN
            </Button>
            <Button size="large" type="text" className="sec-btn sec-btn--quiet" onClick={onRemovePin}>
              Turn off PIN
            </Button>
          </div>
        </div>
      ) : (
        <div className="sec-pin">
          <ol className="sec-steps">
            <li>
              <span className="sec-steps__n">1</span>
              <span>Pick 6 numbers you will remember (not 123456 or 111111).</span>
            </li>
            <li>
              <span className="sec-steps__n">2</span>
              <span>Type them again to confirm.</span>
            </li>
            <li>
              <span className="sec-steps__n">3</span>
              <span>Next time, type your PIN to open the app. Forgot it? Use your password.</span>
            </li>
          </ol>
          <Button type="primary" size="large" className="sec-btn" onClick={() => setPinModalOpen(true)}>
            Set up PIN
          </Button>
        </div>
      )}
    </SectionCard>
  );

  const devicesCard = (
    <SectionCard
      className="sec-card sec-card--devices"
      title={
        <span className="sec-card__title">
          <span className="sec-card__icon sec-card__icon--devices" aria-hidden>
            <DesktopOutlined />
          </span>
          Your devices
        </span>
      }
      subtitle="Browsers and phones where you signed in. Most recent first."
      extra={
        others.length > 0 ? (
          <Button className="sec-btn sec-devices__all" onClick={removeOthers}>
            Remove all other devices
          </Button>
        ) : null
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} title={false} />
      ) : (
        <>
          {thisDevice ? (
            <ul className="sec-devices">
              <DeviceRow device={thisDevice} current />
            </ul>
          ) : null}
          <div className="sec-devices__label">
            Other devices
            <span className="sec-devices__count">{others.length}</span>
          </div>
          {others.length === 0 ? (
            <p className="sec-devices__empty">You are not signed in anywhere else.</p>
          ) : (
            <ul className="sec-devices">
              {visibleOthers.map((d) => (
                <DeviceRow key={d.id} device={d} current={false} onRemove={() => removeOne(d)} />
              ))}
            </ul>
          )}
          {others.length > VISIBLE_OTHERS ? (
            <Button
              type="text"
              block
              className="sec-btn sec-devices__more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
            </Button>
          ) : null}
          <p className="sec-note sec-note--muted">
            <InfoCircleOutlined aria-hidden />
            Last active is the last password sign-in or PIN unlock. Location is not recorded.
          </p>
        </>
      )}
    </SectionCard>
  );

  return (
    <Page className={`sec${isWorker ? ' sec--worker' : ''}`}>
      {isWorker ? (
        <WorkerPageHeader
          title="Security"
          subtitle="Password and PIN"
          onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/my-assignments'))}
        />
      ) : null}
      {modalHolder}
      <div className="sec__inner">
        {isWorker ? null : (
          <div className="sec-who">
            <PersonAvatar
              userId={user?.id}
              fullName={user?.fullName}
              photoVersion={user?.photoVersion}
              size={44}
            />
            <div className="sec-who__text">
              <div className="sec-who__name">{user?.fullName}</div>
              <div className="sec-who__sub">Signed in on this device</div>
            </div>
            <div className="sec-who__chips">
              <StatusPill tone={pinOn ? 'green' : 'slate'} compact>
                PIN {pinOn ? 'on' : 'off'}
              </StatusPill>
              <StatusPill tone="blue" compact>
                {loading ? '…' : others.length + (thisDevice ? 1 : 0)} device
                {others.length + (thisDevice ? 1 : 0) === 1 ? '' : 's'}
              </StatusPill>
            </div>
          </div>
        )}
        <div className="sec__grid">
          <div className="sec__col">{isWorker ? [pinCard, passwordCard] : [passwordCard, pinCard]}</div>
          <div className="sec__col">{devicesCard}</div>
        </div>
      </div>

      <Modal
        open={pinModalOpen}
        title={pinOn ? 'Change your PIN' : 'Set up your PIN'}
        onCancel={() => setPinModalOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width="min(400px, calc(100vw - 32px))"
      >
        <p className="sec-pin__modal-hint">
          Pick 6 numbers, then type them again. This PIN works only on this {deviceWord}.
        </p>
        <PinSetupKeypad
          onSave={onSavePin}
          footer={
            <button type="button" className="pin-keypad__link" onClick={() => setPinModalOpen(false)}>
              Cancel
            </button>
          }
        />
      </Modal>
    </Page>
  );
}
