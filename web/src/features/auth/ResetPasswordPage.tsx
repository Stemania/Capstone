import { Alert, Button, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import './LoginPage.css';

const { Text } = Typography;

const PASSWORD_RULES =
  'At least 8 characters, mix letters with numbers or symbols, and not a common password.';

export default function ResetPasswordPage() {
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
  const [tokenTerminal, setTokenTerminal] = useState(false);

  useEffect(() => {
    if (!tokenFromLink) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authApi.validatePasswordReset(tokenFromLink);
        if (cancelled) return;
        setInfo(
          data.fullName
            ? `Reset password for ${data.fullName} (${data.email || 'your account'}).`
            : 'Choose a new password for your account.',
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
      const { data } = await authApi.validatePasswordReset(values.token, values.identifier);
      setInfo(
        data.fullName
          ? `Reset password for ${data.fullName} (${data.email || 'your account'}).`
          : 'Choose a new password for your account.',
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
      const { data } = await authApi.confirmPasswordReset(
        values.token,
        values.password,
        values.passwordConfirm,
        values.identifier,
      );
      applySession(data);
      localStorage.removeItem('bmsc_has_pin');
      navigate(data.user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders', {
        replace: true,
      });
    } catch (err) {
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
          <div className="login-card__subtitle">Reset your password</div>
        </div>
        <div className="login-card__body">
          <h1 className="login-card__title">Choose a new password</h1>
          <p className="login-card__lead">
            After resetting, you will need to sign in with your new password on other devices.
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
                label="Reset code"
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
            <Link to="/login">Back to sign in</Link>
          </Text>
        </div>
      </div>
    </div>
  );
}
