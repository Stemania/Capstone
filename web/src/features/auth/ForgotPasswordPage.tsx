import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import './LoginPage.css';

export default function ForgotPasswordPage() {
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { identifier: string }) => {
    setSubmitting(true);
    setError('');
    try {
      await authApi.requestPasswordReset(values.identifier);
      setSubmitted(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="login-card__subtitle">Production Scheduling System</div>
        </div>
        <div className="login-card__body">
          {submitted ? (
            <>
              <h1 className="login-card__title">Check your email</h1>
              <p className="login-card__lead">If the account has an email, a reset link is on its way.</p>
            </>
          ) : (
            <>
              <h1 className="login-card__title">Forgot password</h1>
              <p className="login-card__lead">We&apos;ll email you a reset link.</p>
            </>
          )}

          {error && <Alert className="login-alert" type="error" title={error} showIcon />}

          {!submitted && (
            <Form scrollToFirstError={{ block: 'center' }} form={form} layout="vertical" onFinish={onFinish} autoComplete="off" requiredMark={false}>
              <Form.Item
                name="identifier"
                label="Email or mobile number"
                rules={[{ required: true, message: 'Enter your email or mobile number' }]}
              >
                <Input size="large" autoFocus />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Send reset link
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
