import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import {
  CheckCircleFilled,
  CameraOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  QrcodeOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useWorkerTheme } from '../../layouts/WorkerLayout';
import { announceToolsChanged } from '../worker/toolsEvents';
import type { ToolEvent, ToolUnit } from '../../types';

type CameraState = 'starting' | 'scanning' | 'denied' | 'unavailable';
type ScanIntent = 'BORROW' | 'RETURN';

const IS_IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** How to turn the camera back on, for the browser this phone is likely using. */
function AllowCameraSteps() {
  return IS_IOS ? (
    <ol className="w-scan__steps">
      <li>
        Tap <b>aA</b> at the left of the address bar.
      </li>
      <li>
        Tap <b>Website Settings</b>, then set <b>Camera</b> to <b>Allow</b>.
      </li>
      <li>
        Come back and tap <b>Try again</b>.
      </li>
    </ol>
  ) : (
    <ol className="w-scan__steps">
      <li>
        Tap the <b>lock</b> or <b>settings</b> icon next to the web address.
      </li>
      <li>
        Tap <b>Permissions</b> (or <b>Site settings</b>) and set <b>Camera</b> to <b>Allow</b>.
      </li>
      <li>
        Come back and tap <b>Try again</b>.
      </li>
    </ol>
  );
}

export default function ScanToolPage() {
  const { colors } = useWorkerTheme();
  const { user } = useAuth();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [detectedCode, setDetectedCode] = useState('');
  const [detectedUnit, setDetectedUnit] = useState<ToolUnit | null>(null);
  const [detectedIntent, setDetectedIntent] = useState<ScanIntent | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [result, setResult] = useState<ToolEvent | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [attempt, setAttempt] = useState(0);
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
      setManualCode('');
      clearDetected();
      announceToolsChanged();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManual = async () => {
    const code = manualCode.trim();
    if (!code || submitting) return;
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
    if (typeof window !== 'undefined' && (!window.isSecureContext || !navigator.mediaDevices)) {
      setCameraState('unavailable');
      return;
    }
    setCameraState('starting');
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
          qr.stop()
            .then(() => qr.clear())
            .catch(() => {});
        }
      });
    };
  }, [onCodeDetected, attempt]);

  const actionLabel = detectedIntent === 'RETURN' ? 'Return' : 'Borrow';
  const canSubmit = Boolean(detectedIntent) && !submitting && !lookingUp;

  const blocked = cameraState === 'denied' || cameraState === 'unavailable';

  return (
    <div className="w-scan">
      <div className="w-scan__head">
        <div className="w-scan__title">Scan tool QR</div>
        <div className="w-scan__sub">Borrow or return a tool unit</div>
      </div>

      <div className="w-scan__camera">
        <div id="qr-camera-view" />
        {cameraState === 'scanning' && (
          <div className="w-scan__frame" aria-hidden>
            <div className="w-scan__box">
              <span className="w-scan__corner w-scan__corner--tl" />
              <span className="w-scan__corner w-scan__corner--tr" />
              <span className="w-scan__corner w-scan__corner--bl" />
              <span className="w-scan__corner w-scan__corner--br" />
            </div>
          </div>
        )}
        {cameraState === 'starting' && (
          <div className="w-scan__status">
            <span className="w-scan__status-icon">
              <CameraOutlined />
            </span>
            <span>Starting camera…</span>
          </div>
        )}
        {cameraState === 'denied' && (
          <div className="w-scan__status">
            <span className="w-scan__status-icon">
              <StopOutlined />
            </span>
            <div className="w-scan__status-title">Camera is blocked</div>
            <AllowCameraSteps />
            <Button className="w-scan__retry" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {cameraState === 'unavailable' && (
          <div className="w-scan__status">
            <span className="w-scan__status-icon">
              <StopOutlined />
            </span>
            <div className="w-scan__status-title">Camera not available here</div>
            <span style={{ fontSize: 13, maxWidth: 300 }}>
              This page needs a secure (https) connection to use the camera. Type the asset code below
              instead.
            </span>
          </div>
        )}
      </div>

      <div className="w-scan__sheet">
        <div className="w-scan__grip" aria-hidden />
        {detectedCode ? (
          <div className="w-scan__found">
            <div className="w-scan__code">
              <QrcodeOutlined style={{ color: colors.green }} />
              {detectedCode}
            </div>
            {lookingUp ? (
              <div className="w-note" style={{ marginTop: 4 }}>
                Looking up unit…
              </div>
            ) : detectedUnit ? (
              <>
                <div className="w-scan__tool">{detectedUnit.toolTypeName}</div>
                <div className="w-note">
                  {detectedUnit.assetCode} ?{' '}
                  {detectedUnit.currentHolderName ? `Held by ${detectedUnit.currentHolderName}` : 'Available'}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="w-scan__prompt">
            {blocked ? "Type the asset code from the tool's tag" : "Point the camera at a tool's QR code"}
          </div>
        )}
        {lookupError && <div className="w-scan__error">{lookupError}</div>}
        {canSubmit && detectedIntent && (
          <Button
            type="primary"
            block
            className="w-action"
            loading={submitting}
            icon={detectedIntent === 'RETURN' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
            onClick={() => submit(detectedCode, detectedIntent)}
            style={{
              background: detectedIntent === 'RETURN' ? '#2563eb' : colors.green,
              marginBottom: 10,
            }}
          >
            {actionLabel}
          </Button>
        )}
        {detectedCode && !lookingUp && !canSubmit ? (
          <Button block style={{ height: 44, marginBottom: 10 }} onClick={clearDetected}>
            Scan another
          </Button>
        ) : null}
        <form
          className="w-scan__manual"
          onSubmit={(e) => {
            e.preventDefault();
            void handleManual();
          }}
        >
          <Input
            placeholder={blocked ? 'e.g. SEED-ANGLE-GRINDER-001' : 'Or type the asset code'}
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Asset code"
          />
          <Button
            type={blocked ? 'primary' : 'default'}
            htmlType="submit"
            loading={lookingUp || submitting}
            disabled={!manualCode.trim()}
            style={{ height: 48, minWidth: 72, fontWeight: 700 }}
          >
            Go
          </Button>
        </form>
      </div>

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
