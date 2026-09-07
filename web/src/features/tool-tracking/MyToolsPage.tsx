import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Empty, Input, message } from 'antd';
import { SearchOutlined, ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { ToolEvent, ToolUnit } from '../../types';

type TabKey = 'borrowed' | 'history';

export default function MyToolsPage() {
  const { colors } = useWorkerTheme();
  const [held, setHeld] = useState<ToolUnit[]>([]);
  const [history, setHistory] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('borrowed');
  const [query, setQuery] = useState('');

  const fetchData = async () => {
    try {
      const [h, hist] = await Promise.all([
        toolsApi.myTools(),
        toolsApi.myHistory({ page: 1, perPage: 50 }),
      ]);
      setHeld(h.data);
      setHistory(hist.data.items);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const handleReturn = async (unit: ToolUnit) => {
    setReturning(unit.id);
    try {
      await toolsApi.scan(unit.assetCode, { intent: 'RETURN' });
      message.success(`Returned: ${unit.toolTypeName} (${unit.assetCode})`);
      setLoading(true);
      await fetchData();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setReturning(null);
    }
  };

  const filteredHeld = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return held;
    return held.filter(
      (t) =>
        (t.toolTypeName || '').toLowerCase().includes(q) ||
        t.assetCode.toLowerCase().includes(q)
    );
  }, [held, query]);

  return (
    <div>
      <WorkerPageHeader title="Tool Logs" subtitle="Units you are holding and borrow history" />

      <div style={{ padding: 16 }}>
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder="Search units..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginBottom: 14,
            background: colors.inputBg,
            borderColor: colors.cardBorder,
          }}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            marginBottom: 16,
            background: colors.inputBg,
            borderRadius: 12,
            padding: 4,
          }}
        >
          {(
            [
              { key: 'borrowed' as const, label: `Holding (${held.length})` },
              { key: 'history' as const, label: 'History' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                border: 'none',
                borderRadius: 10,
                padding: '10px 8px',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                background: tab === t.key ? colors.card : 'transparent',
                color: tab === t.key ? colors.text : colors.textSecondary,
                boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : tab === 'borrowed' ? (
          filteredHeld.length === 0 ? (
            <Empty description="No tool units currently out with you" style={{ marginTop: 40 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredHeld.map((unit) => (
                <div
                  key={unit.id}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: colors.inputBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: colors.textSecondary,
                      flexShrink: 0,
                    }}
                  >
                    <ToolOutlined />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{unit.toolTypeName}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>{unit.assetCode}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      {unit.heldSince
                        ? `Since ${dayjs(unit.heldSince).format('MMM D, h:mm A')}`
                        : 'Out'}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    loading={returning === unit.id}
                    onClick={() => handleReturn(unit)}
                    style={{ fontWeight: 700, background: '#2563eb' }}
                  >
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : history.length === 0 ? (
          <Empty description="No borrow/return history yet" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((ev) => (
              <div
                key={ev.id}
                style={{
                  background: colors.card,
                  border: `1px solid ${colors.cardBorder}`,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 15 }}>{ev.toolName}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>{ev.assetCode}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                  {ev.type === 'RETURN' ? 'Returned' : 'Borrowed'}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  {dayjs(ev.createdAt).format('MMM D, YYYY h:mm A')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
