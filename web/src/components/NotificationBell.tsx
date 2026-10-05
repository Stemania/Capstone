import { formatShop } from '../utils/shopTime';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Empty, Popover, Spin } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { alertsApi } from '../api/alerts.api';
import type { StaffAlert } from '../types';

const POLL_MS = 60_000;

function alertPath(a: StaffAlert): string | null {
  if (a.jobOrderId) return `/job-orders/${a.jobOrderId}`;
  if (a.supplierOrderId) return `/supplier-orders/${a.supplierOrderId}`;
  return null;
}

export default function NotificationBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<StaffAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshCount = useCallback(() => {
    alertsApi
      .unreadCount()
      .then((r) => setCount(r.data.unreadCount))
      .catch(() => undefined);
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    alertsApi
      .list()
      .then((r) => {
        setItems(r.data.items);
        setCount(r.data.unreadCount);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, POLL_MS);
    window.addEventListener('focus', refreshCount);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refreshCount);
    };
  }, [refreshCount]);

  const openAlert = async (a: StaffAlert, path: string | null = alertPath(a)) => {
    if (!a.read) {
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
      setCount((c) => Math.max(0, c - 1));
      alertsApi.markRead(a.id).catch(refreshCount);
    }
    setOpen(false);
    if (path) navigate(path);
  };

  const markAll = () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setCount(0);
    alertsApi.markAllRead().catch(refreshCount);
  };

  const content = (
    <div className="notif-panel">
      <div className="notif-panel__head">
        <span className="notif-panel__title">Notifications</span>
        <Button type="link" size="small" disabled={count === 0} onClick={markAll}>
          Mark all as read
        </Button>
      </div>
      <div className="notif-panel__list">
        {loading && items.length === 0 ? (
          <div className="notif-panel__empty">
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty
            className="notif-panel__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No notifications yet"
          />
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              className={`notif-item${a.read ? '' : ' is-unread'}`}
              onClick={() => openAlert(a)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openAlert(a);
              }}
            >
              {!a.read && <span className="notif-item__dot" aria-label="Unread" />}
              <div className="notif-item__body">
                <div className="notif-item__title">{a.title}</div>
                {a.message && <div className="notif-item__msg">{a.message}</div>}
                <div className="notif-item__meta">
                  {a.createdAt ? formatShop(a.createdAt, 'D MMM YYYY, h:mm A') : ''}
                  {a.jobOrderId && a.supplierOrderId && a.poNumber && (
                    <>
                      {' · '}
                      <a
                        onClick={(e) => {
                          e.stopPropagation();
                          openAlert(a, `/supplier-orders/${a.supplierOrderId}`);
                        }}
                      >
                        {a.poNumber}
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadList();
      }}
      content={content}
      arrow={{ pointAtCenter: true }}
      styles={{
        container: {
          padding: 0,
          borderRadius: 14,
          boxShadow: '0 8px 28px rgba(15,23,42,0.18)',
          overflow: 'hidden',
        },
      }}
    >
      <button
        type="button"
        className={className ?? 'app-shell__bell'}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notifications"
      >
        <Badge count={count} size="small" overflowCount={99} offset={[2, -2]}>
          <BellOutlined style={{ color: '#fff', fontSize: 20 }} />
        </Badge>
      </button>
    </Popover>
  );
}
