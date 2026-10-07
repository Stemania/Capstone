import { useState } from 'react';
import { Button, Modal } from 'antd';
import { CloudUploadOutlined, DisconnectOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import { formatShop } from '../utils/shopTime';
import { useOfflineOptional, type OfflineContextValue } from './OfflineProvider';

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  padding: '8px 12px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
} as const;

/** Connection, waiting actions, and the first refused action, in the worker header. */
export default function OfflineStatusBar() {
  const offline = useOfflineOptional();
  return offline ? <StatusBar {...offline} /> : null;
}

function StatusBar({
  online,
  lastUpdated,
  pending,
  refused,
  otherUsersPending,
  syncing,
  retry,
  discard,
}: OfflineContextValue) {
  const [open, setOpen] = useState(false);
  const waiting = pending.filter((a) => a.state === 'waiting').length + (refused ? 1 : 0);

  const confirmDiscard = () => {
    if (!refused) return;
    Modal.confirm({
      title: 'Discard this action?',
      content: `"${refused.label}" at ${formatShop(refused.at, 'MMM D, h:mm A')} will not be recorded. Tell the office if the work really happened.`,
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep it',
      onOk: () => {
        discard(refused.id);
        setOpen(false);
      },
    });
  };

  return (
    <>
      {!online && (
        <div style={{ ...barStyle, background: 'rgba(217,119,6,0.18)', color: '#fde68a' }}>
          <DisconnectOutlined />
          <span>
            {lastUpdated
              ? `Offline, last updated ${formatShop(lastUpdated, 'MMM D, h:mm A')}`
              : 'Offline, nothing saved on this phone yet'}
          </span>
        </div>
      )}
      {waiting > 0 && !refused && (
        <div style={{ ...barStyle, background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          <CloudUploadOutlined />
          <span>
            {waiting === 1 ? '1 action waiting to send' : `${waiting} actions waiting to send`}
            {online && syncing ? ' · sending…' : ''}
          </span>
        </div>
      )}
      {refused && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            ...barStyle,
            width: '100%',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            background: '#fee2e2',
            color: '#7A1528',
          }}
        >
          <ExclamationCircleFilled />
          <span>
            Not accepted: {refused.label}. Tap to see why.
            {waiting > 1 ? ` ${waiting - 1} more waiting behind it.` : ''}
          </span>
        </button>
      )}
      {otherUsersPending > 0 && (
        <div style={{ ...barStyle, background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
          {otherUsersPending === 1 ? '1 action' : `${otherUsersPending} actions`} from another
          worker on this phone will be sent when they sign in.
        </div>
      )}

      <Modal
        open={open && !!refused}
        onCancel={() => setOpen(false)}
        title="This action was not accepted"
        footer={null}
        destroyOnHidden
      >
        {refused && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{refused.label}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                Recorded on this phone {formatShop(refused.at, 'MMM D, h:mm A')}
              </div>
            </div>
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 10,
                padding: '10px 12px',
                color: '#7A1528',
                fontSize: 14,
              }}
            >
              {refused.error?.message || 'The server refused this action.'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Actions after this one wait until you try again or discard it, so nothing is
              recorded out of order.
            </div>
            <Button
              type="primary"
              block
              size="large"
              disabled={!online}
              onClick={() => {
                retry(refused.id);
                setOpen(false);
              }}
            >
              {online ? 'Try again' : 'Try again (needs a connection)'}
            </Button>
            <Button danger block size="large" onClick={confirmDiscard}>
              Discard
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
