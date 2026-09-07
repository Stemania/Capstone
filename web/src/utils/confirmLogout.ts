import { Modal } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { createElement } from 'react';

export function confirmLogout(onOk: () => void, content?: string) {
  Modal.confirm({
    title: 'Log out?',
    content: content || 'You will need to sign in again.',
    icon: null,
    centered: true,
    closable: false,
    maskClosable: true,
    width: 300,
    className: 'logout-confirm',
    okText: createElement(
      'span',
      { className: 'logout-confirm__ok-label' },
      createElement(LogoutOutlined),
      'Log out'
    ),
    cancelText: 'Stay signed in',
    okButtonProps: {
      className: 'logout-confirm__ok',
    },
    cancelButtonProps: {
      className: 'logout-confirm__cancel',
    },
    onOk,
  });
}
