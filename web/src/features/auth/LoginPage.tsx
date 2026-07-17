import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getErrorMessage } from '../../api/client';

const { Title, Text } = Typography;

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
        background: '#f0f2f5',
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
          Brothers Machine Shop
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          Production Scheduling System
        </Text>

        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input size="large" placeholder="admin@bmsc.local" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Sign In
          </Button>
        </Form>

        <div style={{ marginTop: 24, fontSize: 12, color: '#888' }}>
          <p>Demo accounts:</p>
          <p>Admin: admin@bmsc.local / Admin123!</p>
          <p>Office: office@bmsc.local / Office123!</p>
          <p>Worker: worker1@bmsc.local / Worker123!</p>
        </div>
      </Card>
    </div>
  );
}
