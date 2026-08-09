import { Form, Input, Button, Alert } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../api/client';
import './LoginPage.css';

const DEMO_ACCOUNTS = [
  {
    key: 'admin',
    label: 'Admin',
    email: 'admin@bmsc.local',
    password: 'Admin123!',
  },
  {
    key: 'office',
    label: 'Office Staff',
    email: 'office@bmsc.local',
    password: 'Office123!',
  },
  {
    key: 'worker1',
    label: 'Juan Dela Cruz',
    email: 'worker1@bmsc.local',
    password: 'Worker123!',
  },
  {
    key: 'worker2',
    label: 'Maria Santos',
    email: 'worker2@bmsc.local',
    password: 'Worker123!',
  },
  {
    key: 'worker3',
    label: 'Pedro Reyes',
    email: 'worker3@bmsc.local',
    password: 'Worker123!',
  },
  {
    key: 'worker4',
    label: 'Ana Lopez',
    email: 'worker4@bmsc.local',
    password: 'Worker123!',
  },
] as const;

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const dest = user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders';
    return <Navigate to={dest} replace />;
  }

  const fillDemo = (email: string, password: string) => {
    setError('');
    form.setFieldsValue({ email, password });
  };

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    setError('');
    try {
      await login(values.email, values.password);
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
          <div className="login-card__brand">Brothers Machine Shop</div>
          <div className="login-card__subtitle">Production Management System</div>
        </div>

        <div className="login-card__body">
          <h1 className="login-card__title">Welcome back</h1>
          <p className="login-card__lead">Sign in to your account to continue</p>

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            autoComplete="off"
            requiredMark="optional"
          >
            <Form.Item
              name="email"
              label={<span><span style={{ color: '#dc2626' }}>* </span>Email</span>}
              rules={[{ required: true, type: 'email' }]}
            >
              <Input
                size="large"
                prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Enter your email"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={<span><span style={{ color: '#dc2626' }}>* </span>Password</span>}
              rules={[{ required: true }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                placeholder="••••••••"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={submitting}
              className="login-card__submit"
            >
              Sign In
            </Button>
          </Form>
        </div>
      </div>

      {/* Temporary test helpers — quick-fill demo credentials */}
      <div className="login-demo">
        <div className="login-demo__label">Quick fill (test)</div>
        <div className="login-demo__buttons">
          {DEMO_ACCOUNTS.map((account) => (
            <Button
              key={account.key}
              type="default"
              className="login-demo__btn"
              onClick={() => fillDemo(account.email, account.password)}
            >
              {account.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
