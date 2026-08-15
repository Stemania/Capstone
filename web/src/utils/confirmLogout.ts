import { Modal } from 'antd';

export function confirmLogout(onOk: () => void, content?: string) {
  Modal.confirm({
    title: 'Log out?',
    content: content || 'You will need to sign in again.',
    okText: 'Log out',
    cancelText: 'Stay signed in',
    centered: true,
    okButtonProps: { style: { background: '#611020', borderColor: '#611020' } },
    onOk,
  });
}
