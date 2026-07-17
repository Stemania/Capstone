import { useEffect, useRef, useState } from 'react';
import { Alert, Card, Typography, message, Spin } from 'antd';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';

const { Title, Text } = Typography;

export default function ScanToolPage() {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [lastEvent, setLastEvent] = useState<{ type: string; toolName?: string } | null>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );
    scannerRef.current = scanner;

    scanner.render(
      async (decodedText) => {
        setScanning(false);
        try {
          const { data } = await toolsApi.scan(decodedText);
          setLastEvent({ type: data.type, toolName: data.toolName });
          message.success(`${data.type}: ${data.toolName || decodedText}`);
        } catch (err) {
          message.error(getErrorMessage(err));
        } finally {
          setTimeout(() => setScanning(true), 2000);
        }
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <Title level={4} style={{ textAlign: 'center' }}>Scan Tool QR</Title>
      <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
        Point your camera at a tool QR code to borrow or return
      </Text>

      <Card>
        <div id="qr-reader" style={{ width: '100%' }} />
        {!scanning && <Spin style={{ display: 'block', textAlign: 'center', marginTop: 16 }} />}
      </Card>

      {lastEvent && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          message={`${lastEvent.type}: ${lastEvent.toolName}`}
          showIcon
        />
      )}
    </div>
  );
}
