import { Alert, Button, Form, Input, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import PasswordRuleHints from './PasswordRuleHints';
import './LoginPage.css';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const tokenFromLink = params.get('token') || '';
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [form] = Form.useForm();
  const password = Form.useWatch('password', form) || '';
  const [checking, setChecking] = useState(Boolean(tokenFromLink));
  const [ready, setReady] = useState(!tokenFromLink);
  const [error, setError] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
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
        setAccountEmail(data.email || '');
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
      setAccountEmail(data.email || values.identifier);
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
      navigate(data.user.role === 'PRODUCTION_WORKER' ? '/home' : '/dashboard', {
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
    <div className="login-page login-page--password">
      <div className="login-page__bg" aria-hidden />
      <div className="login-page__veil" aria-hidden />
      <div className="login-card">
        <div className="login-card__header">
          <img className="login-card__logo" src="/logo.png" alt="Brothers Machine Shop logo" />
          <div className="login-card__brand">
            Brothers Machine Shop and
            <br />
            Services Corporation
          </div>
          <div className="login-card__subtitle">Reset your password</div>
        </div>
        <div className="login-card__body">
          <h1 className="login-card__title">Choose a new password</h1>
          {accountEmail && !tokenTerminal && (
            <p className="login-card__account">
              For <strong>{accountEmail}</strong>
            </p>
          )}
          <p className="login-card__lead">You will need to sign in again on other devices.</p>

          {checking && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <Spin />
            </div>
          )}

          {error && <Alert className="login-alert" type="error" title={error} showIcon />}

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
                rules={[{ required: true, message: 'Enter the reset code' }]}
              >
                <Input size="large" inputMode="numeric" maxLength={6} placeholder="6-digit code" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={submitting}
                className="login-card__submit"
              >
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
              <Form.Item
                name="password"
                label="New password"
                extra={<PasswordRuleHints password={password} />}
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
              <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={submitting}
                className="login-card__submit"
              >
                Save password and sign in
              </Button>
            </Form>
          )}

          <div className="login-card__footer">
            <Link to="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
