import { Button, Dropdown, Table, Tooltip, type MenuProps, type TableProps } from 'antd';
import { MoreOutlined } from '@ant-design/icons';

/**
 * Table with the shared header style, 44px rows, hover and pagination.
 * Pass `pagination={false}` for short tables.
 */
export default function DataTable<T extends object>({ className, pagination, size, ...rest }: TableProps<T>) {
  return (
    <Table<T>
      {...rest}
      size={size ?? 'middle'}
      className={`ui-table${className ? ` ${className}` : ''}`}
      pagination={
        pagination === false
          ? false
          : {
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `${total} total`,
              hideOnSinglePage: false,
              ...(pagination || {}),
            }
      }
    />
  );
}

/** The "⋯" row menu. Secondary row actions go here. */
export function RowMenu({
  items,
  label = 'More actions',
  disabled,
}: {
  items: MenuProps['items'];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight" disabled={disabled}>
      <Tooltip title={label} mouseEnterDelay={0.4}>
        <Button
          type="text"
          size="small"
          className="ui-rowmenu"
          icon={<MoreOutlined />}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
        />
      </Tooltip>
    </Dropdown>
  );
}
