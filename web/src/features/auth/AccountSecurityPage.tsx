import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Spin,
  message,
} from 'antd';
import {
  LeftOutlined,
  LockOutlined,
  MobileOutlined,
  TabletOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getOrCreateDeviceId } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import type { UserDevice } from '../../types';
import PinSetupKeypad from './PinSetupKeypad';
import './AccountSecurityPage.css';

function formatDeviceName(label: string | null | undefined, deviceId: string): string {
  const raw = (label || '').trim();
  if (!raw) return `Device ${deviceId.slice(0, 8)}`;
  if (!raw.includes('Mozilla') && raw.length <= 48) return raw;

  let os = 'Device';
  if (/iPhone|iPod/.test(raw)) os = 'iPhone';
  else if (/iPad/.test(raw)) os = 'iPad';
  else if (/Android/.test(raw)) os = 'Android';
  else if (/Windows/.test(raw)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(raw)) os = 'Mac';

  let browser = '';
  if (/Edg\//.test(raw)) browser = 'Edge';
  else if (/Chrome\//.test(raw) && !/Edg/.test(raw)) browser = 'Chrome';
  else if (/Firefox\//.test(raw)) browser = 'Firefox';
  else if (/Safari\//.test(raw) && !/Chrome/.test(raw)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

function devicePinLabel(device: UserDevice): string {
  if (device.revokedAt) return 'Revoked';
  return device.hasPin ? 'PIN enabled' : 'Password only';
}

export default function AccountSecurityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwordForm] = Form.useForm();
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const deviceId = getOrCreateDeviceId();

  const homePath =
    user?.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders';

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(homePath);
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await authApi.listDevices();
      setDevices(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSavePin = async (pin: string) => {
    await authApi.setPin(pin);
    localStorage.setItem('bmsc_has_pin', '1');
    message.success('PIN saved for this device');
    setPinModalOpen(false);
    load();
  };

  const onRemovePin = async () => {
    try {
      await authApi.removePin();
      localStorage.removeItem('bmsc_has_pin');
      message.success('PIN removed');
      load();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onChangePassword = async (values: {
    currentPassword: string;
    newPassword: string;
  }) => {
    setPasswordSaving(true);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      localStorage.removeItem('bmsc_has_pin');
      message.success('Password updated. Device PINs were cleared.');
      passwordForm.resetFields();
      load();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  };

  const revoke = (row: UserDevice) => {
    Modal.confirm({
      title: 'Revoke this device?',
      content: 'PIN unlock will stop working on that device.',
      okText: 'Revoke',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        await authApi.revokeDevice(row.id);
        if (row.deviceId === deviceId) localStorage.removeItem('bmsc_has_pin');
        message.success('Device revoked');
        load();
      },
    });
  };

  const thisDevice = devices.find((d) => d.deviceId === deviceId && !d.revokedAt);
  const activeDevices = devices.filter((d) => !d.revokedAt);

  return (
    <div className="acct-sec">
      <header className="acct-sec__header">
        <div className="acct-sec__header-row">
          <button type="button" className="acct-sec__back" onClick={goBack} aria-label="Go back">
            <LeftOutlined />
          </button>
          <div className="acct-sec__header-text">
            <h1 className="acct-sec__title">Account security</h1>
            <p className="acct-sec__subtitle">
              Password, device PIN, and signed-in sessions
            </p>
          </div>
        </div>
      </header>

      <div className="acct-sec__scroll">
        <div className="acct-sec__body">
          <section className="acct-sec__card" aria-labelledby="acct-password">
            <div className="acct-sec__card-head">
              <div className="acct-sec__card-icon acct-sec__card-icon--password">
                <LockOutlined />
              </div>
              <div>
                <h2 id="acct-password" className="acct-sec__card-title">
                  Change password
                </h2>
                <p className="acct-sec__card-desc">
                  Use a strong password you have not used elsewhere.
                </p>
              </div>
            </div>
            <Alert
              type="info"
              showIcon
              className="acct-sec__notice"
              message="Updating your password clears PIN unlock on every device."
            />
            <Form
              form={passwordForm}
              layout="vertical"
              onFinish={onChangePassword}
              className="acct-sec__form"
              requiredMark="optional"
            >
              <Form.Item
                name="currentPassword"
                label="Current password"
                rules={[{ required: true, message: 'Enter your current password' }]}
              >
                <Input.Password size="large" placeholder="Current password" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="New password"
                rules={[
                  { required: true, message: 'Enter a new password' },
                  { min: 8, message: 'At least 8 characters' },
                ]}
              >
                <Input.Password size="large" placeholder="At least 8 characters" />
              </Form.Item>
              <div className="acct-sec__actions">
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  loading={passwordSaving}
                  block
                >
                  Update password
                </Button>
              </div>
            </Form>
          </section>

          <section className="acct-sec__card" aria-labelledby="acct-pin">
            <div className="acct-sec__card-head">
              <div className="acct-sec__card-icon acct-sec__card-icon--pin">
                <MobileOutlined />
              </div>
              <div>
                <h2 id="acct-pin" className="acct-sec__card-title">
                  PIN for this device
                </h2>
                <p className="acct-sec__card-desc">
                  Optional quick unlock after a full password sign-in on this phone or tablet.
                </p>
              </div>
            </div>
            {thisDevice?.hasPin ? (
              <div className="acct-sec__actions">
                <span className="acct-sec__pin-status">PIN active on this device</span>
                <Button danger size="large" onClick={onRemovePin}>
                  Remove PIN
                </Button>
              </div>
            ) : (
              <Button type="primary" size="large" block onClick={() => setPinModalOpen(true)}>
                Set PIN
              </Button>
            )}
          </section>

          <section className="acct-sec__card" aria-labelledby="acct-devices">
            <div className="acct-sec__card-head">
              <div className="acct-sec__card-icon acct-sec__card-icon--devices">
                <TabletOutlined />
              </div>
              <div>
                <h2 id="acct-devices" className="acct-sec__card-title">
                  Your devices
                </h2>
                <p className="acct-sec__card-desc">
                  Browsers and phones where you have signed in recently.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="acct-sec__loading">
                <Spin />
              </div>
            ) : activeDevices.length === 0 ? (
              <div className="acct-sec__empty">No active devices yet</div>
            ) : (
              <div className="acct-sec__device-list">
                {activeDevices.map((item) => {
                  const isCurrent = item.deviceId === deviceId;
                  return (
                    <div
                      key={item.id}
                      className={`acct-sec__device${isCurrent ? ' acct-sec__device--current' : ''}`}
                    >
                      <div className="acct-sec__device-top">
                        <div className="acct-sec__device-name">
                          {formatDeviceName(item.deviceLabel, item.deviceId)}
                        </div>
                        {isCurrent ? <span className="acct-sec__device-badge">This device</span> : null}
                      </div>
                      <div className="acct-sec__device-meta">{devicePinLabel(item)}</div>
                      {!isCurrent ? (
                        <Button
                          type="link"
                          danger
                          className="acct-sec__device-revoke"
                          onClick={() => revoke(item)}
                        >
                          Revoke access
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={pinModalOpen}
        title="Set a device PIN"
        onCancel={() => setPinModalOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width="min(400px, calc(100vw - 32px))"
      >
        <p style={{ color: '#475569', marginBottom: 16, textAlign: 'center', fontSize: 14 }}>
          Choose a 6-digit PIN for faster unlock on this device only.
        </p>
        <PinSetupKeypad
          onSave={onSavePin}
          footer={
            <button
              type="button"
              className="pin-keypad__link"
              onClick={() => setPinModalOpen(false)}
            >
              Cancel
            </button>
          }
        />
      </Modal>
    </div>
  );
}
