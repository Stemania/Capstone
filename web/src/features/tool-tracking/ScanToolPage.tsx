import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import {
  CheckCircleFilled,
  CameraOutlined,
  ArrowUpOutlined,
  QrcodeOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
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
  const { colors, mode, toggleMode, logout } = useWorkerTheme();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [detectedCode, setDetectedCode] = useState('');
  const [result, setResult] = useState<ToolEvent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const borrow = async (code: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data } = await toolsApi.scan(code.trim(), { intent: 'BORROW' });
      setResult(data);
      setManualOpen(false);
      setManualCode('');
      setDetectedCode('');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const qr = new Html5Qrcode('qr-camera-view');
    scannerRef.current = qr;
    let cancelled = false;

    const startPromise = qr
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => setDetectedCode(decodedText.trim()),
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
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: 'calc(100dvh - 88px)',
        background: '#000',
        color: '#fff',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          padding: '14px 16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Scan QR</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Align QR code within the frame</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={toggleMode}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#fff',
              width: 36,
              height: 36,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          </button>
          <button
            onClick={logout}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#fff',
              width: 36,
              height: 36,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <LogoutOutlined />
          </button>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 'calc(100dvh - 88px - 190px)',
          minHeight: 280,
          overflow: 'hidden',
        }}
      >
        <div id="qr-camera-view" style={{ width: '100%', height: '100%' }} />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'relative', width: 240, height: 240 }}>
            <div style={corner('#22c55e', { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 })} />
            <div style={corner('#22c55e', { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 })} />
            <div style={corner('#22c55e', { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 })} />
            <div style={corner('#22c55e', { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 })} />
          </div>
        </div>

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
              color: '#cbd5e1',
              padding: 24,
              background: 'rgba(0,0,0,0.55)',
              textAlign: 'center',
            }}
          >
            <CameraOutlined style={{ fontSize: 40 }} />
            {cameraState === 'starting' ? (
              <span>Starting camera…</span>
            ) : (
              <span>
                Camera permission denied.
                <br />
                Use manual entry below.
              </span>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          background: colors.card,
          color: colors.text,
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          border: `1px solid ${colors.cardBorder}`,
        }}
      >
        {detectedCode ? (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <QrcodeOutlined style={{ fontSize: 18, color: colors.green }} />
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>
                {detectedCode}
              </span>
            </div>
            <Button
              type="primary"
              block
              size="large"
              loading={submitting}
              icon={<ArrowUpOutlined />}
              onClick={() => borrow(detectedCode)}
              style={{
                height: 50,
                fontWeight: 800,
                background: colors.green,
                marginBottom: 10,
              }}
            >
              Borrow Tool
            </Button>
          </>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>
            Point the camera at the tool&apos;s QR code
          </div>
        )}

        <Button block onClick={() => setManualOpen(true)} style={{ fontWeight: 600 }}>
          Enter tag number manually
        </Button>
      </div>

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
          onPressEnter={() => manualCode.trim() && borrow(manualCode)}
          autoFocus
          style={{ marginBottom: 16 }}
        />
        <Button
          type="primary"
          block
          size="large"
          loading={submitting}
          disabled={!manualCode.trim()}
          onClick={() => borrow(manualCode)}
        >
          Borrow
        </Button>
      </Modal>

      <Modal open={Boolean(result)} onCancel={() => setResult(null)} footer={null} centered closable={false}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CheckCircleFilled
            style={{
              fontSize: 64,
              color: colors.green,
              marginBottom: 16,
            }}
          />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, marginBottom: 4 }}>
            BORROWED
          </div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>{result?.toolName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 24 }}>
            {result?.toolCode}
          </div>
          <Button
            type="primary"
            block
            size="large"
            style={{ height: 48, fontWeight: 700 }}
            onClick={() => setResult(null)}
          >
            Done — keep scanning
          </Button>
        </div>
      </Modal>
    </div>
  );
}
