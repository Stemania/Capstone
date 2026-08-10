import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import {
  CheckCircleFilled,
  CameraOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  QrcodeOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme } from '../../layouts/WorkerLayout';
import type { Tool, ToolEvent } from '../../types';

type CameraState = 'starting' | 'scanning' | 'denied';
type ScanIntent = 'BORROW' | 'RETURN' | 'ISSUE';

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
  const [detectedTool, setDetectedTool] = useState<Tool | null>(null);
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
    setDetectedTool(null);
    setDetectedIntent(null);
    setLookupError(null);
    setLookingUp(false);
  }, []);

  const resolveIntent = useCallback(
    (match: Tool): { intent: ScanIntent | null; error: string | null } => {
      if (match.category === 'CONSUMABLE') {
        if ((match.quantityOnHand ?? 0) <= 0) {
          return { intent: null, error: 'Out of stock' };
        }
        return { intent: 'ISSUE', error: null };
      }
      const mine = match.myOutstanding ?? 0;
      if (mine > 0) {
        return { intent: 'RETURN', error: null };
      }
      if ((match.quantityOnHand ?? 0) <= 0) {
        return { intent: null, error: 'None available on the shelf' };
      }
      return { intent: 'BORROW', error: null };
    },
    []
  );

  const lookupTool = useCallback(
    async (code: string) => {
      const seq = ++lookupSeq.current;
      setLookingUp(true);
      setLookupError(null);
      setDetectedTool(null);
      setDetectedIntent(null);
      try {
        const { data: tools } = await toolsApi.list();
        if (seq !== lookupSeq.current || detectedCodeRef.current !== code) return;

        const match = tools.find((t) => t.code.toUpperCase() === code.toUpperCase());
        if (!match) {
          setLookupError('Item not found');
          setLookingUp(false);
          return;
        }

        setDetectedTool(match);
        const { intent, error } = resolveIntent(match);
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
      void lookupTool(code);
    },
    [lookupTool]
  );

  const submit = async (code: string, intent: ScanIntent) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data } = await toolsApi.scan(code.trim(), { intent, quantity: 1 });
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
    setDetectedTool(null);
    setDetectedIntent(null);
    try {
      const { data: tools } = await toolsApi.list();
      const match = tools.find((t) => t.code.toUpperCase() === code.toUpperCase());
      if (!match) {
        setLookupError('Item not found');
        message.error('Item not found');
        return;
      }
      setDetectedTool(match);
      const { intent, error } = resolveIntent(match);
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

  const actionLabel =
    detectedIntent === 'RETURN'
      ? 'Return'
      : detectedIntent === 'ISSUE'
        ? 'Issue'
        : 'Borrow';
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
          <div style={{ fontSize: 12, opacity: 0.75 }}>Item type QR — one tap to take or return</div>
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
                Looking up item…
              </div>
            ) : detectedTool ? (
              <div style={{ textAlign: 'center', marginBottom: lookupError ? 6 : 12 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{detectedTool.name}</div>
                <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                  {[detectedTool.sizeSpec, detectedTool.category === 'CONSUMABLE' ? 'Consumable' : 'Returnable']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                  On hand: {detectedTool.quantityOnHand} {detectedTool.unit}
                  {detectedTool.myOutstanding
                    ? ` · You hold ${detectedTool.myOutstanding}`
                    : ''}
                </div>
              </div>
            ) : null}
            {lookupError && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#dc2626',
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
                icon={
                  detectedIntent === 'RETURN' ? (
                    <ArrowDownOutlined />
                  ) : (
                    <ArrowUpOutlined />
                  )
                }
                onClick={() => submit(detectedCode, detectedIntent)}
                style={{
                  height: 50,
                  fontWeight: 800,
                  background:
                    detectedIntent === 'RETURN'
                      ? '#2563eb'
                      : detectedIntent === 'ISSUE'
                        ? '#0f1c2e'
                        : colors.green,
                  marginBottom: 10,
                }}
              >
                {actionLabel}
              </Button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>
            Point the camera at the item&apos;s QR code
          </div>
        )}

        <Button block onClick={() => setManualOpen(true)} style={{ fontWeight: 600 }}>
          Enter code manually
        </Button>
      </div>

      <Modal
        open={manualOpen}
        onCancel={() => setManualOpen(false)}
        footer={null}
        title="Enter item code"
        centered
      >
        <Input
          size="large"
          placeholder="e.g. INV-DRILL-10"
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
          <CheckCircleFilled
            style={{
              fontSize: 64,
              color: colors.green,
              marginBottom: 16,
            }}
          />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, marginBottom: 4 }}>
            {result?.type === 'RETURN'
              ? 'RETURNED'
              : result?.type === 'ISSUE'
                ? 'ISSUED'
                : 'BORROWED'}
          </div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>{result?.toolName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>
            {[result?.toolSizeSpec, result?.toolCode].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
            Qty {result?.quantity}
            {result?.quantityOnHandAfter != null
              ? ` · ${result.quantityOnHandAfter} left on hand`
              : ''}
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
