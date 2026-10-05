import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import {
  CheckCircleFilled,
  CameraOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  QrcodeOutlined,
  CalendarOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useWorkerTheme } from '../../layouts/WorkerLayout';
import type { ToolEvent, ToolUnit } from '../../types';
import { useNavigate } from 'react-router-dom';

type CameraState = 'starting' | 'scanning' | 'denied';
type ScanIntent = 'BORROW' | 'RETURN';

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
  const { colors, logout } = useWorkerTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [detectedCode, setDetectedCode] = useState('');
  const [detectedUnit, setDetectedUnit] = useState<ToolUnit | null>(null);
  const [detectedIntent, setDetectedIntent] = useState<ScanIntent | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [result, setResult] = useState<ToolEvent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lookupSeq = useRef(0);
  const detectedCodeRef = useRef('');

  const clearDetected = useCallback(() => {
    detectedCodeRef.current = '';
    setDetectedCode('');
    setDetectedUnit(null);
    setDetectedIntent(null);
    setLookupError(null);
    setLookingUp(false);
  }, []);

  const resolveIntent = useCallback(
    (unit: ToolUnit): { intent: ScanIntent | null; error: string | null } => {
      if (unit.status === 'RETIRED') {
        return { intent: null, error: 'This tool is retired' };
      }
      if (unit.status === 'UNDER_REPAIR') {
        return { intent: null, error: 'This tool is under repair' };
      }
      if (unit.status === 'OUT') {
        if (unit.currentHolderId && user?.id && unit.currentHolderId !== user.id) {
          return {
            intent: null,
            error: `Already out with ${unit.currentHolderName || 'another worker'}`,
          };
        }
        return { intent: 'RETURN', error: null };
      }
      if (unit.status === 'AVAILABLE') {
        return { intent: 'BORROW', error: null };
      }
      return { intent: null, error: 'Cannot scan this unit' };
    },
    [user?.id]
  );

  const lookupUnit = useCallback(
    async (code: string) => {
      const seq = ++lookupSeq.current;
      setLookingUp(true);
      setLookupError(null);
      setDetectedUnit(null);
      setDetectedIntent(null);
      try {
        const { data: unit } = await toolsApi.lookupUnit(code);
        if (seq !== lookupSeq.current || detectedCodeRef.current !== code) return;
        setDetectedUnit(unit);
        const { intent, error } = resolveIntent(unit);
        setDetectedIntent(intent);
        setLookupError(error);
      } catch (err) {
        if (seq !== lookupSeq.current) return;
        setLookupError(getErrorMessage(err));
        setDetectedIntent(null);
      } finally {
        if (seq === lookupSeq.current) setLookingUp(false);
      }
    },
    [resolveIntent]
  );

  const onCodeDetected = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code || code === detectedCodeRef.current) return;
      detectedCodeRef.current = code;
      setDetectedCode(code);
      void lookupUnit(code);
    },
    [lookupUnit]
  );

  const submit = async (code: string, intent: ScanIntent) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data } = await toolsApi.scan(code.trim(), { intent });
      setResult(data);
      setManualOpen(false);
      setManualCode('');
      clearDetected();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManual = async () => {
    const code = manualCode.trim();
    if (!code || submitting) return;
    setManualOpen(false);
    setManualCode('');
    detectedCodeRef.current = code;
    setDetectedCode(code);
    setLookingUp(true);
    setLookupError(null);
    setDetectedUnit(null);
    setDetectedIntent(null);
    try {
      const { data: unit } = await toolsApi.lookupUnit(code);
      setDetectedUnit(unit);
      const { intent, error } = resolveIntent(unit);
      if (!intent) {
        setDetectedIntent(null);
        setLookupError(error);
        if (error) message.error(error);
        return;
      }
      await submit(code, intent);
    } catch (err) {
      message.error(getErrorMessage(err));
      setLookupError(getErrorMessage(err));
    } finally {
      setLookingUp(false);
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
        (decodedText) => onCodeDetected(decodedText),
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
  }, [onCodeDetected]);

  const actionLabel = detectedIntent === 'RETURN' ? 'Return' : 'Borrow';
  const canSubmit = Boolean(detectedIntent) && !submitting && !lookingUp;

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
          <div style={{ fontSize: 12, opacity: 0.75 }}>Individual tool units — borrow or return</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate('/schedule')}
            aria-label="Schedule"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#fff',
              width: 48,
              height: 48,
              borderRadius: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CalendarOutlined />
          </button>
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#fff',
              width: 48,
              height: 48,
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
          height: 'calc(100dvh - 88px - 260px)',
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
                marginBottom: 4,
              }}
            >
              <QrcodeOutlined style={{ fontSize: 18, color: colors.green }} />
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>
                {detectedCode}
              </span>
            </div>
            {lookingUp ? (
              <div style={{ textAlign: 'center', fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
                Looking up unit…
              </div>
            ) : detectedUnit ? (
              <div style={{ textAlign: 'center', marginBottom: lookupError ? 6 : 12 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{detectedUnit.toolTypeName}</div>
                <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                  {detectedUnit.assetCode} · {detectedUnit.status}
                </div>
                {detectedUnit.currentHolderName ? (
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                    Held by {detectedUnit.currentHolderName}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>Available</div>
                )}
              </div>
            ) : null}
            {lookupError && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#7A1528',
                  marginBottom: 12,
                }}
              >
                {lookupError}
              </div>
            )}
            {canSubmit && detectedIntent && (
              <Button
                type="primary"
                block
                size="large"
                loading={submitting}
                icon={detectedIntent === 'RETURN' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
                onClick={() => submit(detectedCode, detectedIntent)}
                style={{
                  height: 50,
                  fontWeight: 800,
                  background: detectedIntent === 'RETURN' ? '#2563eb' : colors.green,
                  marginBottom: 10,
                }}
              >
                {actionLabel}
              </Button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>
            Point the camera at a tool unit&apos;s QR code
          </div>
        )}

        <Button block size="large" onClick={() => setManualOpen(true)} style={{ height: 48, fontWeight: 600 }}>
          Enter asset code manually
        </Button>
      </div>

      <Modal open={manualOpen} onCancel={() => setManualOpen(false)} footer={null} title="Enter asset code" centered>
        <Input
          size="large"
          placeholder="e.g. SEED-ANGLE-GRINDER-001"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onPressEnter={() => void handleManual()}
          autoFocus
          style={{ marginBottom: 16 }}
        />
        <Button
          type="primary"
          block
          size="large"
          loading={lookingUp || submitting}
          disabled={!manualCode.trim()}
          onClick={() => void handleManual()}
        >
          Continue
        </Button>
      </Modal>

      <Modal open={Boolean(result)} onCancel={() => setResult(null)} footer={null} centered closable={false}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CheckCircleFilled style={{ fontSize: 64, color: colors.green, marginBottom: 16 }} />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, marginBottom: 4 }}>
            {result?.type === 'RETURN' ? 'RETURNED' : 'BORROWED'}
          </div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>{result?.toolName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>
            {result?.assetCode}
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
