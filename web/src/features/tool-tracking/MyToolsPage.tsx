import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Empty, Input, message } from 'antd';
import { SearchOutlined, ToolOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { ToolEvent } from '../../types';

interface HeldTool {
  id: string;
  name: string;
  code: string;
  since: string;
}

export default function MyToolsPage() {
  const { colors } = useWorkerTheme();
  const [tools, setTools] = useState<HeldTool[]>([]);
  const [history, setHistory] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);
  const [tab, setTab] = useState<'borrowed' | 'history'>('borrowed');
  const [query, setQuery] = useState('');

  const fetchData = async () => {
    try {
      const [held, hist] = await Promise.all([
        toolsApi.myTools(),
        toolsApi.myHistory({ perPage: 50 }),
      ]);
      setTools(held.data);
      setHistory(hist.data.items);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleReturn = async (tool: HeldTool) => {
    setReturning(tool.id);
    try {
      await toolsApi.scan(tool.code, { intent: 'RETURN' });
      message.success(`Returned: ${tool.name}`);
      setLoading(true);
      await fetchData();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setReturning(null);
    }
  };

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)
    );
  }, [tools, query]);

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (e) =>
        (e.toolName || '').toLowerCase().includes(q) ||
        (e.toolCode || '').toLowerCase().includes(q)
    );
  }, [history, query]);

  return (
    <div>
      <WorkerPageHeader
        title="My Tools"
        subtitle="Tools currently in your possession"
      />

      <div style={{ padding: 16 }}>
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder="Search tools..."
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
            background: colors.chipBg,
            borderRadius: 12,
            padding: 4,
            marginBottom: 16,
            border: `1px solid ${colors.cardBorder}`,
          }}
        >
          {(
            [
              { key: 'borrowed' as const, label: `Borrowed (${tools.length})` },
              { key: 'history' as const, label: 'History' },
            ]
          ).map((t) => (
            <button
              key={t.key}
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
                boxShadow: tab === t.key ? colors.shadow : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
        ) : tab === 'borrowed' ? (
          filteredTools.length === 0 ? (
            <Empty description="No tools borrowed" style={{ marginTop: 40 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredTools.map((tool) => (
                <div
                  key={tool.id}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 14,
                    boxShadow: colors.shadow,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      background: colors.chipBg,
                      color: colors.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      flexShrink: 0,
                    }}
                  >
                    <ToolOutlined />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{tool.name}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: colors.greenSoft,
                          color: colors.green,
                          flexShrink: 0,
                        }}
                      >
                        In Use
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>
                      {tool.code}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      Borrowed {dayjs(tool.since).format('MMM D, h:mm A')}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    danger
                    loading={returning === tool.id}
                    onClick={() => handleReturn(tool)}
                    style={{ fontWeight: 700 }}
                  >
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : filteredHistory.length === 0 ? (
          <Empty description="No tool history yet" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredHistory.map((event) => (
              <div
                key={event.id}
                style={{
                  background: colors.card,
                  border: `1px solid ${colors.cardBorder}`,
                  borderRadius: 14,
                  padding: 14,
                  boxShadow: colors.shadow,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: colors.chipBg,
                    color: event.type === 'BORROW' ? colors.green : colors.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  <ToolOutlined />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{event.toolName}</div>
                  <div style={{ fontSize: 12, color: colors.textSecondary }}>
                    {event.toolCode} · {event.type === 'BORROW' ? 'Borrowed' : 'Returned'}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textSecondary }}>
                    {dayjs(event.createdAt).format('MMM D, h:mm A')}
                  </div>
                </div>
                <RightOutlined style={{ color: colors.textSecondary }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
