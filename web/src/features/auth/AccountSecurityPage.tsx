import { Alert, Button, Form, Input, List, Modal, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { authApi, getOrCreateDeviceId } from '../../api/auth.api';
import { getErrorMessage } from '../../api/client';
import type { UserDevice } from '../../types';
import PinSetupKeypad from './PinSetupKeypad';

const { Title, Text } = Typography;

export default function AccountSecurityPage() {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwordForm] = Form.useForm();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const deviceId = getOrCreateDeviceId();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await authApi.listDevices();
      setDevices(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSavePin = async (pin: string) => {
    await authApi.setPin(pin);
    localStorage.setItem('bmsc_has_pin', '1');
    message.success('PIN saved for this device');
    setPinModalOpen(false);
    load();
  };

  const onRemovePin = async () => {
    try {
      await authApi.removePin();
      localStorage.removeItem('bmsc_has_pin');
      message.success('PIN removed');
      load();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const onChangePassword = async (values: {
    currentPassword: string;
    newPassword: string;
  }) => {
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      localStorage.removeItem('bmsc_has_pin');
      message.success('Password updated. Device PINs were cleared.');
      passwordForm.resetFields();
      load();
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  };

  const revoke = (row: UserDevice) => {
    Modal.confirm({
      title: 'Revoke this device?',
      content: 'PIN unlock will stop working on that device.',
      onOk: async () => {
        await authApi.revokeDevice(row.id);
        if (row.deviceId === deviceId) localStorage.removeItem('bmsc_has_pin');
        message.success('Device revoked');
        load();
      },
    });
  };

  const thisDevice = devices.find((d) => d.deviceId === deviceId && !d.revokedAt);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 40px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>
        Account security
      </Title>
      <Text type="secondary">
        Manage your password, optional device PIN, and signed-in devices.
      </Text>

      <div style={{ marginTop: 24, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
        <Title level={5}>Change password</Title>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Changing your password clears PIN unlock on every device."
        />
        <Form form={passwordForm} layout="vertical" onFinish={onChangePassword}>
          <Form.Item name="currentPassword" label="Current password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New password"
            rules={[{ required: true, min: 8 }]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Update password
          </Button>
        </Form>
      </div>

      <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
        <Title level={5}>PIN for this device</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Optional. Only unlocks this phone after a full password sign-in.
        </Text>
        {thisDevice?.hasPin ? (
          <Space>
            <Text>PIN is set on this device.</Text>
            <Button danger onClick={onRemovePin}>
              Remove PIN
            </Button>
          </Space>
        ) : (
          <Button type="primary" onClick={() => setPinModalOpen(true)}>
            Set PIN
          </Button>
        )}
      </div>

      <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
        <Title level={5}>Your devices</Title>
        <List
          loading={loading}
          dataSource={devices}
          locale={{ emptyText: 'No devices yet' }}
          renderItem={(item) => (
            <List.Item
              actions={
                item.revokedAt
                  ? []
                  : [
                      <Button key="revoke" type="link" danger onClick={() => revoke(item)}>
                        Revoke
                      </Button>,
                    ]
              }
            >
              <List.Item.Meta
                title={
                  <>
                    {item.deviceLabel || item.deviceId.slice(0, 8)}
                    {item.deviceId === deviceId ? ' (this device)' : ''}
                  </>
                }
                description={
                  item.revokedAt
                    ? `Revoked ${item.revokedAt}`
                    : item.hasPin
                      ? 'PIN enabled'
                      : 'No PIN'
                }
              />
            </List.Item>
          )}
        />
      </div>

      <Modal
        open={pinModalOpen}
        title="Set a device PIN"
        onCancel={() => setPinModalOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width={400}
      >
        <p style={{ color: '#475569', marginBottom: 16, textAlign: 'center' }}>
          Choose a 6-digit PIN for faster unlock on this device only.
        </p>
        <PinSetupKeypad
          onSave={onSavePin}
          footer={
            <button
              type="button"
              className="pin-keypad__link"
              onClick={() => setPinModalOpen(false)}
            >
              Cancel
            </button>
          }
        />
      </Modal>
    </div>
  );
}
