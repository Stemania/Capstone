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
    <Popover trigger="click" title={title} content={<div className="ui-infotip__body">{content}</div>}>
      <button type="button" aria-label={label} title={label} className="ui-infotip">
        <InfoCircleOutlined />
      </button>
    </Popover>
  );
}
