import { Alert, Button, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import './LoginPage.css';

const { Text } = Typography;

const PASSWORD_RULES =
  'At least 8 characters, mix letters with numbers or symbols, and not a common password.';

export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const tokenFromLink = params.get('token') || '';
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [form] = Form.useForm();
  const [checking, setChecking] = useState(Boolean(tokenFromLink));
  const [ready, setReady] = useState(!tokenFromLink);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codeValidated, setCodeValidated] = useState(Boolean(tokenFromLink));
  /** True only for invalid / expired / already-used invitation — hide the form. */
  const [tokenTerminal, setTokenTerminal] = useState(false);

  useEffect(() => {
    if (!tokenFromLink) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authApi.validateInvitation(tokenFromLink);
        if (cancelled) return;
        setInfo(
          data.fullName
            ? `Welcome, ${data.fullName}. Choose a password for ${data.email || 'your account'}.`
            : 'Choose a password for your account.',
        );
        form.setFieldsValue({ token: tokenFromLink });
        setCodeValidated(true);
        setReady(true);
        setTokenTerminal(false);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setTokenTerminal(true);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenFromLink, form]);

  const onValidateCode = async (values: { identifier: string; token: string }) => {
    setSubmitting(true);
    setError('');
    setTokenTerminal(false);
    try {
      const { data } = await authApi.validateInvitation(values.token, values.identifier);
      setInfo(
        data.fullName
          ? `Welcome, ${data.fullName}. Choose a password for ${data.email || 'your account'}.`
          : 'Choose a password for your account.',
      );
      form.setFieldsValue({
        identifier: values.identifier,
        token: values.token,
      });
      setCodeValidated(true);
      setReady(true);
      setTokenTerminal(false);
    } catch (err) {
      setError(getErrorMessage(err));
      setTokenTerminal(true);
    } finally {
      setSubmitting(false);
    }
  };

  const onFinish = async (values: {
    identifier?: string;
    token: string;
    password: string;
    passwordConfirm: string;
  }) => {
    setSubmitting(true);
    setError('');
    try {
      const { data } = await authApi.acceptInvitation(
        values.token,
        values.password,
        values.passwordConfirm,
        values.identifier,
      );
      applySession(data);
      if (data.device?.hasPin) {
        localStorage.setItem('bmsc_has_pin', '1');
      } else if (data.user.role === 'PRODUCTION_WORKER') {
        sessionStorage.setItem('bmsc_offer_pin', '1');
      }
      navigate(data.user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders', {
        replace: true,
      });
    } catch (err) {
      // Keep the form mounted for password validation failures; only token
      // failures are terminal (handled at validate time).
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const showPasswordForm = ready && codeValidated && !tokenTerminal;
  const showCodeForm = !tokenFromLink && !codeValidated && !tokenTerminal;

  return (
    <div className="login-page">
      <div className="login-page__bg" aria-hidden />
      <div className="login-page__veil" aria-hidden />
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__brand">Brothers Machine Shop</div>
          <div className="login-card__subtitle">Set your password</div>
        </div>
        <div className="login-card__body">
          <h1 className="login-card__title">Create your password</h1>
          <p className="login-card__lead">
            Only you will know this password. Admins cannot set or view it.
          </p>

          {checking && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin />
            </div>
          )}

          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          {info && !tokenTerminal && (
            <Alert type="info" message={info} showIcon style={{ marginBottom: 16 }} />
          )}

          {showCodeForm && (
            <Form form={form} layout="vertical" onFinish={onValidateCode} autoComplete="off">
              <Form.Item
                name="identifier"
                label="Email or mobile"
                rules={[{ required: true, message: 'Email or mobile is required' }]}
              >
                <Input size="large" placeholder="name@bmsc.local or 09XXXXXXXXX" />
              </Form.Item>
              <Form.Item
                name="token"
                label="Invitation code"
                rules={[{ required: true, message: 'Enter the 6-digit SMS code' }]}
              >
                <Input size="large" inputMode="numeric" maxLength={6} placeholder="6-digit code" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Continue
              </Button>
            </Form>
          )}

          {showPasswordForm && (
            <Form form={form} layout="vertical" onFinish={onFinish} autoComplete="off">
              {!tokenFromLink && (
                <>
                  <Form.Item name="identifier" hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item name="token" hidden>
                    <Input />
                  </Form.Item>
                </>
              )}
              {tokenFromLink && (
                <Form.Item name="token" hidden>
                  <Input />
                </Form.Item>
              )}
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Password requirements"
                description={PASSWORD_RULES}
              />
              <Form.Item
                name="password"
                label="New password"
                rules={[
                  { required: true, message: 'Password is required' },
                  { min: 8, message: 'At least 8 characters' },
                ]}
              >
                <Input.Password size="large" placeholder="At least 8 characters" />
              </Form.Item>
              <Form.Item
                name="passwordConfirm"
                label="Confirm password"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Confirm your password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password size="large" placeholder="Repeat password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Save password and sign in
              </Button>
            </Form>
          )}

          <Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 12 }}>
            Already activated? <a href="/login">Sign in</a>
          </Text>
        </div>
      </div>
    </div>
  );
}
