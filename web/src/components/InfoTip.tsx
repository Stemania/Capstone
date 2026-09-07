import { Popover } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

type Props = {
  title?: ReactNode;
  content: ReactNode;
  /** Accessible label for the trigger button */
  label?: string;
};

/** Compact click-to-open info; use instead of always-visible Alert banners. */
export default function InfoTip({ title, content, label = 'More info' }: Props) {
  return (
    <Popover
      trigger="click"
      title={title}
      content={<div style={{ maxWidth: 300, fontSize: 13, lineHeight: 1.45 }}>{content}</div>}
    >
      <button
        type="button"
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: 2,
          border: 'none',
          background: 'transparent',
          color: '#1677ff',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          verticalAlign: 'middle',
        }}
      >
        <InfoCircleOutlined />
      </button>
    </Popover>
  );
}
