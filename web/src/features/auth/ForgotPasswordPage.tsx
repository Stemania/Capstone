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
    <div className="login-page">
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
          {!submitted && (
            <>
              <h1 className="login-card__title">Forgot password</h1>
              <p className="login-card__lead">
                Enter the email or mobile on your account. We send a reset link when an email is on file.
              </p>
            </>
          )}

          {error && <Alert className="login-alert" type="error" title={error} showIcon />}

          {submitted ? (
            <div className="login-card__success">
              <Alert
                className="login-alert"
                type="success"
                showIcon
                title="Reset link sent"
                description="If that account has an email on file, check your inbox for instructions."
              />
            </div>
          ) : (
            <Form form={form} layout="vertical" onFinish={onFinish} autoComplete="off">
              <Form.Item
                name="identifier"
                label="Email or mobile"
                rules={[{ required: true, message: 'Email or mobile is required' }]}
              >
                <Input size="large" placeholder="name@bmsc.local or 09XXXXXXXXX" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Send reset instructions
              </Button>
            </Form>
          )}

          <p style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
