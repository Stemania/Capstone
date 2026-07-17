import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../api/client';

const { Text } = Typography;

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
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f1f5f9',
        padding: 16,
      }}
    >
      <Card
        style={{ width: '100%', maxWidth: 420, border: '1px solid #e2e8f0' }}
        styles={{ body: { padding: 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.5 }}>
            METAL<span style={{ color: '#2563eb' }}>LINK</span> ERP
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Brothers Machine Shop and Services Corporation
          </Text>
        </div>

        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input size="large" placeholder="admin@bmsc.local" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            size="large"
            loading={submitting}
            style={{ fontWeight: 600, height: 44 }}
          >
            Sign In
          </Button>
        </Form>

        <div
          style={{
            marginTop: 24,
            padding: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 12,
            color: '#64748b',
            lineHeight: 1.8,
          }}
        >
          <strong>Demo accounts</strong>
          <br />
          Admin: admin@bmsc.local / Admin123!
          <br />
          Office: office@bmsc.local / Office123!
          <br />
          Worker: worker1@bmsc.local / Worker123!
        </div>
      </Card>
    </div>
  );
}
