import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';

export type SplitActionButtonProps = {
  children: ReactNode;
  menu: MenuProps;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  type?: 'primary' | 'default';
  className?: string;
};

function mergeMenu(menu: MenuProps, onDone: () => void): MenuProps {
  return {
    ...menu,
    onClick: (info) => {
      menu.onClick?.(info);
      onDone();
    },
    items: menu.items?.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !('onClick' in item)) {
        return item;
      }
      const itemOnClick = item.onClick;
      return {
        ...item,
        onClick: (info) => {
          itemOnClick?.(info);
          onDone();
        },
      };
    }),
  };
}

export default function SplitActionButton({
  children,
  menu,
  onClick,
  loading = false,
  disabled = false,
  type = 'primary',
  className,
}: SplitActionButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState<number>();

  const measureWidth = () => {
    if (wrapRef.current) setMenuWidth(wrapRef.current.offsetWidth);
  };

  useLayoutEffect(() => {
    measureWidth();
  }, [children, loading, open]);

  const rootClass = [
    'jo-split-btn',
    open ? 'jo-split-btn--open' : '',
    disabled ? 'jo-split-btn--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const closeMenu = () => setOpen(false);

  return (
    <div ref={wrapRef} className={rootClass} role="group">
      <Button
        type={type}
        loading={loading}
        disabled={disabled}
        className="jo-split-btn__main"
        onClick={() => {
          if (!disabled) onClick?.();
        }}
      >
        {children}
      </Button>
      <Dropdown
        menu={mergeMenu(menu, closeMenu)}
        trigger={['click']}
        open={disabled ? false : open}
        onOpenChange={(next) => {
          if (!disabled) {
            setOpen(next);
            if (next) measureWidth();
          }
        }}
        disabled={disabled}
        placement="bottomRight"
        overlayClassName="jo-split-btn__dropdown"
        overlayStyle={menuWidth ? { width: menuWidth, minWidth: menuWidth } : undefined}
      >
        <Button
          type={type}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="menu"
          className="jo-split-btn__trigger"
          icon={<DownOutlined className="jo-split-btn__chevron" />}
        />
      </Dropdown>
    </div>
  );
}
