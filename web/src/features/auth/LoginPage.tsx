import { Form, Input, Button, Alert, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { authApi, getOrCreateDeviceId } from '../../api/auth.api';
import { getErrorCode, getErrorMessage } from '../../api/client';
import PinKeypad from './PinKeypad';
import './LoginPage.css';

const { Text } = Typography;

const DEMO_ACCOUNTS = [
  { key: 'admin', label: 'Admin', identifier: 'admin@bmsc.local', password: 'Admin123!' },
  { key: 'office', label: 'Office Staff', identifier: 'office@bmsc.local', password: 'Office123!' },
  { key: 'worker1', label: 'Juan Dela Cruz', identifier: 'worker1@bmsc.local', password: 'Worker123!' },
  { key: 'worker2', label: 'Maria Santos', identifier: 'worker2@bmsc.local', password: 'Worker123!' },
] as const;

export default function LoginPage() {
  const { login, user, loading, applySession } = useAuth();
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const [pinError, setPinError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [checkingPin, setCheckingPin] = useState(true);
  const [failSignal, setFailSignal] = useState(0);

  useEffect(() => {
    getOrCreateDeviceId();
    let cancelled = false;
    (async () => {
      try {
        const hint = localStorage.getItem('bmsc_has_pin') === '1';
        if (!cancelled) setPinMode(hint);
      } finally {
        if (!cancelled) setCheckingPin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && user) {
    const dest = user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders';
    return <Navigate to={dest} replace />;
  }

  const fillDemo = (identifier: string, password: string) => {
    setError('');
    setPinError('');
    setPinMode(false);
    form.setFieldsValue({ identifier, password });
  };

  const onPasswordLogin = async (values: { identifier: string; password: string }) => {
    setSubmitting(true);
    setError('');
    try {
      await login(values.identifier, values.password);
      sessionStorage.setItem('bmsc_offer_pin', '1');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onPinComplete = async (pin: string) => {
    setSubmitting(true);
    setPinError('');
    setError('');
    try {
      const { data } = await authApi.unlockWithPin(pin);
      applySession(data);
      localStorage.setItem('bmsc_has_pin', '1');
    } catch (err) {
      const code = getErrorCode(err);
      const message = getErrorMessage(err);
      if (code === 'PIN_LOCKED') {
        localStorage.removeItem('bmsc_has_pin');
        setPinMode(false);
        setError(message);
        setPinError('');
        return;
      }
      setPinError(message);
      setFailSignal((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingPin) {
    return <div className="login-page" />;
  }

  return (
    <div className="login-page">
      <div className="login-page__bg" aria-hidden />
      <div className="login-page__veil" aria-hidden />

      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__brand">Brothers Machine Shop</div>
          <div className="login-card__subtitle">Production Management System</div>
        </div>

        <div className="login-card__body">
          {!pinMode && (
            <>
              <h1 className="login-card__title">Sign in</h1>
              <p className="login-card__lead">Use your email or mobile number and password</p>
            </>
          )}

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

          {pinMode ? (
            <PinKeypad
              title="Enter your PIN"
              error={pinError}
              busy={submitting}
              failSignal={failSignal}
              onComplete={onPinComplete}
              footer={
                <button
                  type="button"
                  className="pin-keypad__link"
                  onClick={() => {
                    setPinMode(false);
                    setPinError('');
                    setError('');
                  }}
                >
                  Use password instead
                </button>
              }
            />
          ) : (
            <Form
              form={form}
              layout="vertical"
              onFinish={onPasswordLogin}
              autoComplete="off"
              requiredMark="optional"
            >
              <Form.Item
                name="identifier"
                label={
                  <span>
                    <span style={{ color: '#dc2626' }}>* </span>Email or mobile
                  </span>
                }
                rules={[{ required: true, message: 'Email or mobile is required' }]}
              >
                <Input
                  size="large"
                  prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="name@bmsc.local or 09XXXXXXXXX"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label={
                  <span>
                    <span style={{ color: '#dc2626' }}>* </span>Password
                  </span>
                }
                rules={[{ required: true }]}
              >
                <Input.Password
                  size="large"
                  prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="••••••••"
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Sign In
              </Button>
              {localStorage.getItem('bmsc_has_pin') === '1' && (
                <Button type="link" block style={{ marginTop: 8 }} onClick={() => setPinMode(true)}>
                  Use PIN instead
                </Button>
              )}
            </Form>
          )}
          {!pinMode && (
            <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
              New accounts receive an invite link or SMS code to set their own password.
            </Text>
          )}
        </div>
      </div>

      <div className="login-demo">
        <div className="login-demo__label">Quick fill (test)</div>
        <div className="login-demo__buttons">
          {DEMO_ACCOUNTS.map((account) => (
            <Button
              key={account.key}
              type="default"
              className="login-demo__btn"
              onClick={() => fillDemo(account.identifier, account.password)}
            >
              {account.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
