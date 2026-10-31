import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './confirmAction.css';

type ConfirmOptions = {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  /** Maroon button for deleting, removing, disabling or signing out. */
  danger?: boolean;
  /** Wider card for content such as a QR code or a date field. */
  wide?: boolean;
  /** A rejected promise keeps the dialog open so the person can try again. */
  onOk?: () => unknown | Promise<unknown>;
  onCancel?: () => void;
};

type NoticeOptions = {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  wide?: boolean;
};

type DialogProps = ConfirmOptions & { single?: boolean; close: () => void };

function Dialog({ title, content, okText, cancelText, danger, wide, onOk, onCancel, single, close }: DialogProps) {
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    if (busy) return;
    close();
    onCancel?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const confirm = async () => {
    if (!onOk) {
      close();
      return;
    }
    setBusy(true);
    try {
      await onOk();
      close();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div
      className="app-confirm-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className={`app-confirm-card${wide ? ' app-confirm-card--wide' : ''}`}
        role={single ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="app-confirm-title"
      >
        <div id="app-confirm-title" className="app-confirm-card__title">
          {title}
        </div>
        {content ? <div className="app-confirm-card__body">{content}</div> : null}
        <div className="app-confirm-card__actions">
          {single ? (
            <button type="button" className="acct-sheet-btn" onClick={() => close()}>
              {okText || 'OK'}
            </button>
          ) : (
            <>
              <button type="button" className="acct-sheet-btn" onClick={cancel} disabled={busy}>
                {cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                className={`acct-sheet-btn ${danger ? 'acct-sheet-btn--danger' : 'acct-sheet-btn--primary'}`}
                onClick={confirm}
                disabled={busy}
              >
                {busy ? 'Working…' : okText || 'OK'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function mount(props: Omit<DialogProps, 'close'>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Dialog {...props} close={close} />);
}

/** Ask before an action. Same look as the log-out confirm. */
export function confirmAction(options: ConfirmOptions) {
  mount(options);
}

/** A message with one OK button. */
export function showNotice(options: NoticeOptions) {
  mount({ ...options, single: true });
}
