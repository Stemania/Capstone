import { LogoutOutlined } from '@ant-design/icons';
import { createElement, type MouseEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Custom logout confirm — plain buttons sharing `.acct-sheet-btn` with
 * "Account security" so Ant Design cannot override typography.
 */
export function confirmLogout(onOk: () => void, content?: string) {
  const host = document.createElement('div');
  host.className = 'logout-confirm-host';
  document.body.appendChild(host);

  let root: Root | null = createRoot(host);

  const close = () => {
    root?.unmount();
    root = null;
    host.remove();
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  root.render(
    createElement(
      'div',
      {
        className: 'logout-confirm-overlay',
        role: 'presentation',
        onClick: (e: MouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) close();
        },
      },
      createElement(
        'div',
        {
          className: 'logout-confirm-card',
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'logout-confirm-title',
        },
        createElement(
          'div',
          { id: 'logout-confirm-title', className: 'logout-confirm-card__title' },
          'Log out?',
        ),
        createElement(
          'div',
          { className: 'logout-confirm-card__body' },
          content || 'You will need to sign in again.',
        ),
        createElement(
          'div',
          { className: 'logout-confirm-card__actions' },
          createElement(
            'button',
            {
              type: 'button',
              className: 'acct-sheet-btn',
              onClick: close,
            },
            'Stay signed in',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'acct-sheet-btn acct-sheet-btn--danger',
              onClick: () => {
                close();
                onOk();
              },
            },
            createElement(LogoutOutlined),
            'Log out',
          ),
        ),
      ),
    ),
  );
}
