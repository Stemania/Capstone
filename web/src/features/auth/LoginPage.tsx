import { Form, Input, Button, Alert } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../api/client';

const NAVY = '#0f1c2e';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const dest = user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/job-orders';
    return <Navigate to={dest} replace />;
  }

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
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f1f5f9',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: NAVY,
            padding: '28px 32px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.3, color: '#fff', lineHeight: 1.3 }}>
            Brothers Machine Shop
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
            Production Management System
          </div>
        </div>

        <div style={{ padding: 32 }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>Welcome back</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
            Sign in to your account to continue
          </div>

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

          <Form layout="vertical" onFinish={onFinish} autoComplete="off">
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input
                size="large"
                prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
                placeholder="admin@bmsc.local"
              />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true }]}>
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
              style={{ fontWeight: 700, height: 46 }}
            >
              Sign In
            </Button>
          </Form>

          <div
            style={{
              marginTop: 24,
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              fontSize: 12,
              color: '#64748b',
              lineHeight: 1.9,
            }}
          >
            <span
              style={{
                display: 'block',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                color: '#475569',
                marginBottom: 2,
              }}
            >
              Demo accounts
            </span>
            Admin: admin@bmsc.local / Admin123!
            <br />
            Office: office@bmsc.local / Office123!
            <br />
            Worker: worker1@bmsc.local / Worker123!
          </div>
        </div>
      </div>
    </div>
  );
}
