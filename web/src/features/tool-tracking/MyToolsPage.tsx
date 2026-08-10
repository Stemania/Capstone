import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Empty, Input, message } from 'antd';
import { SearchOutlined, ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { Tool } from '../../types';

interface HeldTool {
  id: string;
  name: string;
  code: string;
  category: string;
  sizeSpec: string | null;
  unit: string;
  quantity: number;
  quantityOnHand: number;
  since: string | null;
}

export default function MyToolsPage() {
  const { colors } = useWorkerTheme();
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
      await toolsApi.scan(tool.code, { intent: 'RETURN', quantity: 1 });
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
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.sizeSpec || '').toLowerCase().includes(q)
    );
  }, [tools, query]);

  const filteredAllTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTools;
    return allTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.sizeSpec || '').toLowerCase().includes(q)
    );
  }, [allTools, query]);

  return (
    <div>
      <WorkerPageHeader
        title="Tool Logs"
        subtitle="Outstanding returnables and shop stock"
      />

      <div style={{ padding: 16 }}>
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder="Search items..."
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
              { key: 'borrowed' as const, label: `Holding (${tools.length})` },
              { key: 'all' as const, label: 'All items' },
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
          filteredTools.length === 0 ? (
            <Empty description="Nothing outstanding" style={{ marginTop: 40 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredTools.map((tool) => (
                <div
                  key={tool.id}
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
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{tool.name}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>
                      {[tool.sizeSpec, tool.code].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      Holding {tool.quantity} {tool.unit}
                      {tool.since
                        ? ` · since ${dayjs(tool.since).format('MMM D, h:mm A')}`
                        : ''}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    loading={returning === tool.id}
                    onClick={() => handleReturn(tool)}
                    style={{ fontWeight: 700, background: '#2563eb' }}
                  >
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : filteredAllTools.length === 0 ? (
          <Empty description="No items found" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredAllTools.map((tool) => {
              const mine = tool.myOutstanding ?? 0;
              return (
                <div
                  key={tool.id}
                  style={{
                    background: colors.card,
                    border: `1px solid ${
                      tool.lowStock ? '#f59e0b' : colors.cardBorder
                    }`,
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
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{tool.name}</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>
                      {[
                        tool.sizeSpec,
                        tool.category === 'CONSUMABLE' ? 'Consumable' : 'Returnable',
                        tool.code,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                      On hand {tool.quantityOnHand} {tool.unit}
                      {mine > 0 ? ` · you hold ${mine}` : ''}
                      {tool.lowStock ? ' · low stock' : ''}
                    </div>
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
