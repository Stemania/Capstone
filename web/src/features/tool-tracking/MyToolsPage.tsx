import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Empty, Input, message } from 'antd';
import { SearchOutlined, ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { Tool } from '../../types';

interface HeldTool {
  id: string;
  name: string;
  code: string;
  since: string;
}

export default function MyToolsPage() {
  const { colors } = useWorkerTheme();
  const { user } = useAuth();
  const [tools, setTools] = useState<HeldTool[]>([]);
  const [allTools, setAllTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);
  const [tab, setTab] = useState<'borrowed' | 'all'>('borrowed');
  const [query, setQuery] = useState('');

  const fetchData = async () => {
    try {
      const [held, all] = await Promise.all([toolsApi.myTools(), toolsApi.list()]);
      setTools(held.data);
      setAllTools(all.data);
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

  const filteredAllTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTools;
    return allTools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)
    );
  }, [allTools, query]);

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
              { key: 'all' as const, label: 'All Tools' },
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
          <div className="page-spinner">
            <Spin size="large" />
          </div>
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
                    minHeight: 96,
                    boxShadow: colors.shadow,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: colors.chipBg,
                      color: colors.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    <ToolOutlined />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{tool.name}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>{tool.code}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      Borrowed {dayjs(tool.since).format('MMM D, h:mm A')}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    danger
                    loading={returning === tool.id}
                    onClick={() => handleReturn(tool)}
                    style={{ fontWeight: 700, flexShrink: 0 }}
                  >
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : filteredAllTools.length === 0 ? (
          <Empty description="No tools found" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredAllTools.map((tool) => {
              const heldByMe = tool.custody?.holderId === user?.id;
              const inUse = Boolean(tool.custody);
              const statusText = !inUse ? 'Available' : heldByMe ? 'You have it' : 'In Use';
              const statusColor = !inUse ? colors.green : heldByMe ? colors.accent : colors.amber;
              const statusBg = !inUse
                ? colors.greenSoft
                : heldByMe
                  ? 'rgba(59,130,246,0.12)'
                  : 'rgba(217,119,6,0.12)';

              return (
                <div
                  key={tool.id}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 14,
                    minHeight: 96,
                    boxShadow: colors.shadow,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: colors.chipBg,
                      color: statusColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    <ToolOutlined />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{tool.name}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>{tool.code}</div>
                    {inUse && !heldByMe && tool.custody?.holderName && (
                      <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                        With {tool.custody.holderName} since{' '}
                        {dayjs(tool.custody.since).format('MMM D, h:mm A')}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 999,
                        background: statusBg,
                        color: statusColor,
                      }}
                    >
                      {statusText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
