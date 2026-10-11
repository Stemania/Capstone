import { useEffect, useState } from 'react';
import { Badge, Button, Popover } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../hooks/useAuth';
import { useMyOperationsOptional } from '../my-assignments/useMyOperations';
import { inboxStore, markRead, updateInbox, type InboxState } from './workerInbox';

function ago(at: string) {
  const mins = dayjs().diff(dayjs(at), 'minute');
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return dayjs(at).format('MMM D');
}

/** New assignments and materials arriving, from the worker's own job list. */
export default function WorkerBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const mine = useMyOperationsOptional();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InboxState | null>(() => (userId ? inboxStore.read(userId) : null));

  const loading = mine?.loading ?? true;
  const failed = Boolean(mine?.error);
  const loaded = mine?.loaded;
  useEffect(() => {
    if (!userId || !loaded || loading || failed) return;
    setState((prev) => {
      const next = updateInbox(prev ?? inboxStore.read(userId), loaded, new Date().toISOString());
      if (next !== prev) inboxStore.write(userId, next);
      return next;
    });
  }, [userId, loaded, loading, failed]);

  if (!mine || !userId) return null;

  const items = state?.items ?? [];
  const unread = items.filter((i) => !i.read).length;

  const save = (next: InboxState) => {
    setState(next);
    inboxStore.write(userId, next);
  };

  const content = (
    <div>
      <div className="w-notif-head">
        <span style={{ fontWeight: 800, fontSize: 14 }}>Notifications</span>
        <Button type="link" size="small" disabled={!unread} onClick={() => state && save(markRead(state))}>
          Mark all as read
        </Button>
      </div>
      <div className="w-notif-list">
        {items.length === 0 ? (
          <div className="w-notif-empty">
            Nothing new. You will see new jobs and materials arriving here.
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`w-notif ${item.read ? 'is-read' : 'is-unread'}`}
              onClick={() => {
                if (state) save(markRead(state, item.id));
                setOpen(false);
                navigate(`/my-assignments/${item.jobOrderId}`);
              }}
            >
              <span className="w-notif__dot" aria-hidden />
              <span style={{ minWidth: 0 }}>
                <span className="w-notif__title" style={{ display: 'block' }}>
                  {item.title}
                </span>
                <span className="w-notif__meta" style={{ display: 'block' }}>
                  {[item.detail, ago(item.at)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
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
      onOpenChange={setOpen}
      content={content}
      arrow={false}
      styles={{ container: { padding: 0, borderRadius: 14, overflow: 'hidden' } }}
    >
      <button
        type="button"
        className="w-iconbtn"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Badge count={unread} size="small" overflowCount={9} offset={[1, 2]}>
          <BellOutlined style={{ fontSize: 20, color: '#fff' }} />
        </Badge>
      </button>
    </Popover>
  );
}
