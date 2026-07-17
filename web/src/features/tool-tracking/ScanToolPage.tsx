import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import { CheckCircleFilled, CameraOutlined } from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme } from '../../layouts/WorkerLayout';
import type { ToolEvent } from '../../types';

type CameraState = 'starting' | 'scanning' | 'denied';

const corner = (color: string, pos: React.CSSProperties): React.CSSProperties => ({
  position: 'absolute',
  width: 36,
  height: 36,
  borderColor: color,
  borderStyle: 'solid',
  borderWidth: 0,
  ...pos,
});

export default function ScanToolPage() {
  const { colors } = useWorkerTheme();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [result, setResult] = useState<ToolEvent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleCode = async (code: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      scannerRef.current?.pause(true);
    } catch {
      // scanner may not be running (manual entry path)
    }
    setSubmitting(true);
    try {
      const { data } = await toolsApi.scan(code.trim());
      setResult(data);
      setManualOpen(false);
      setManualCode('');
    } catch (err) {
      message.error(getErrorMessage(err));
      resumeScanning();
    } finally {
      setSubmitting(false);
    }
  };

  const resumeScanning = () => {
    processingRef.current = false;
    try {
      scannerRef.current?.resume();
    } catch {
      // camera not active; ignore
    }
  };

  const closeResult = () => {
    setResult(null);
    resumeScanning();
  };

  useEffect(() => {
    const qr = new Html5Qrcode('qr-camera-view');
    scannerRef.current = qr;
    let cancelled = false;

    const startPromise = qr
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => handleCode(decodedText),
        () => {}
      )
      .then(() => {
        if (!cancelled) setCameraState('scanning');
      })
      .catch(() => {
        if (!cancelled) setCameraState('denied');
      });

    return () => {
      cancelled = true;
      startPromise.finally(() => {
        if (qr.isScanning) {
          qr.stop().catch(() => {});
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBorrow = result?.type === 'BORROW';

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 3, marginBottom: 4 }}>
        SCAN TOOL TAG
      </div>
      <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 16 }}>
        Hold steady over the tool QR code
      </div>

      <div
        style={{
          position: 'relative',
          borderRadius: 16,
          overflow: 'hidden',
          background: '#000',
          aspectRatio: '3 / 4',
          maxHeight: '58dvh',
        }}
      >
        <div id="qr-camera-view" style={{ width: '100%', height: '100%' }} />

        <div style={corner(colors.green, { top: 16, left: 16, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 })} />
        <div style={corner(colors.green, { top: 16, right: 16, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 })} />
        <div style={corner(colors.green, { bottom: 16, left: 16, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 })} />
        <div style={corner(colors.green, { bottom: 16, right: 16, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 })} />

        {cameraState !== 'scanning' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: colors.textSecondary,
              padding: 24,
              background: 'rgba(0,0,0,0.6)',
            }}
          >
            <CameraOutlined style={{ fontSize: 40 }} />
            {cameraState === 'starting' ? (
              <span>Starting camera…</span>
            ) : (
              <span>
                Camera permission denied.
                <br />
                Enable camera access, or enter the tag number manually below.
              </span>
            )}
          </div>
        )}
      </div>

      <Button
        block
        size="large"
        style={{ marginTop: 20, height: 52, fontWeight: 700, fontSize: 16 }}
        onClick={() => setManualOpen(true)}
      >
        Enter tag number manually
      </Button>

      <Modal
        open={manualOpen}
        onCancel={() => setManualOpen(false)}
        footer={null}
        title="Enter tool code"
        centered
      >
        <Input
          size="large"
          placeholder="e.g. TOOL-MILL-001"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onPressEnter={() => manualCode.trim() && handleCode(manualCode)}
          autoFocus
          style={{ marginBottom: 16 }}
        />
        <Button
          type="primary"
          block
          size="large"
          loading={submitting}
          disabled={!manualCode.trim()}
          onClick={() => handleCode(manualCode)}
        >
          Submit
        </Button>
      </Modal>

      <Modal open={Boolean(result)} onCancel={closeResult} footer={null} centered closable={false}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CheckCircleFilled
            style={{ fontSize: 64, color: isBorrow ? colors.green : colors.accent, marginBottom: 16 }}
          />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, marginBottom: 4 }}>
            {isBorrow ? 'BORROWED' : 'RETURNED'}
          </div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>{result?.toolName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 24 }}>{result?.toolCode}</div>
          <Button type="primary" block size="large" style={{ height: 48, fontWeight: 700 }} onClick={closeResult}>
            Done — keep scanning
          </Button>
        </div>
      </Modal>
    </div>
  );
}
