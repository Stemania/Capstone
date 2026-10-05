import { formatShop } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Empty, Input, Segmented, message } from 'antd';
import { DownOutlined, RightOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { ToolType, ToolUnit, ToolUnitStatus } from '../../types';

type TabKey = 'borrowed' | 'all';

function statusMeta(
  status: ToolUnitStatus,
  colors: { green: string; amber: string; accent: string; textSecondary: string }
): { label: string; color: string } {
  switch (status) {
    case 'AVAILABLE':
      return { label: 'Available', color: colors.green };
    case 'OUT':
      return { label: 'Out', color: colors.amber };
    case 'UNDER_REPAIR':
      return { label: 'Repair', color: colors.accent };
    case 'RETIRED':
      return { label: 'Retired', color: colors.textSecondary };
    default:
      return { label: status, color: colors.textSecondary };
  }
}

export default function MyToolsPage() {
  const { colors } = useWorkerTheme();
  const [held, setHeld] = useState<ToolUnit[]>([]);
  const [types, setTypes] = useState<ToolType[]>([]);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('borrowed');
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const fetchData = async () => {
    try {
      const [h, t] = await Promise.all([
        toolsApi.myTools(),
        toolsApi.listTypes({ includeUnits: true }),
      ]);
      setHeld(h.data);
      setTypes(t.data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
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

  const filteredTypes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => {
      if (t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)) return true;
      return (t.units || []).some(
        (u) =>
          u.assetCode.toLowerCase().includes(q) ||
          (u.currentHolderName || '').toLowerCase().includes(q)
      );
    });
  }, [types, query]);

  const totalUnits = useMemo(
    () => types.reduce((sum, t) => sum + (t.totalUnits || 0), 0),
    [types]
  );

  return (
    <div>
      <WorkerPageHeader title="Tool Logs" subtitle="Holding & all tools" />

      <div style={{ padding: 16 }}>
        <Input
          allowClear
          className="worker-search"
          prefix={<SearchOutlined style={{ color: colors.textSecondary }} />}
          placeholder={tab === 'all' ? 'Search tools...' : 'Search units...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginBottom: 12,
            background: colors.inputBg,
            borderColor: colors.cardBorder,
          }}
        />

        <Segmented
          block
          className="worker-seg"
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          options={[
            { label: `Holding (${held.length})`, value: 'borrowed' },
            { label: `All Tools (${totalUnits})`, value: 'all' },
          ]}
          style={{ marginBottom: 14 }}
        />

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
                        ? `Since ${formatShop(unit.heldSince, 'MMM D, h:mm A')}`
                        : 'Out'}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    loading={returning === unit.id}
                    onClick={() => handleReturn(unit)}
                    style={{ height: 48, minWidth: 88, fontWeight: 700, background: '#2563eb' }}
                  >
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : filteredTypes.length === 0 ? (
          <Empty description="No tools match your search" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredTypes.map((type) => {
              const units = (type.units || []).filter((u) => u.status !== 'RETIRED');
              const available = type.availableCount ?? 0;
              const out = type.outCount ?? 0;
              const repair = type.repairCount ?? 0;
              const total = available + out + repair;
              const open = expandedIds.has(type.id);

              return (
                <div
                  key={type.id}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.cardBorder}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(type.id)}
                    aria-expanded={open}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 14,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: colors.text,
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
                        fontSize: 22,
                      }}
                    >
                      <ToolOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{type.name}</div>
                      <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                        {available} available
                        {out > 0 ? ` · ${out} out` : ''}
                        {repair > 0 ? ` · ${repair} repair` : ''}
                        {` · ${total} total`}
                      </div>
                    </div>
                    <span style={{ color: colors.textSecondary, fontSize: 12, flexShrink: 0 }}>
                      {open ? <DownOutlined /> : <RightOutlined />}
                    </span>
                  </button>

                  {open ? (
                    units.length > 0 ? (
                      <div
                        style={{
                          borderTop: `1px solid ${colors.cardBorder}`,
                          padding: '10px 14px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          background: colors.inputBg,
                        }}
                      >
                        {units.map((unit) => {
                          const st = statusMeta(unit.status, colors);
                          return (
                            <div
                              key={unit.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                                background: colors.card,
                                borderRadius: 10,
                                padding: '8px 10px',
                                border: `1px solid ${colors.cardBorder}`,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700 }}>{unit.assetCode}</div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: colors.textSecondary,
                                    marginTop: 1,
                                  }}
                                >
                                  {unit.status === 'OUT'
                                    ? unit.currentHolderName
                                      ? `Held by ${unit.currentHolderName}`
                                      : 'Out'
                                    : unit.status === 'AVAILABLE'
                                      ? 'On rack'
                                      : st.label}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: st.color,
                                  flexShrink: 0,
                                }}
                              >
                                {st.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        style={{
                          borderTop: `1px solid ${colors.cardBorder}`,
                          padding: '10px 14px 12px',
                          fontSize: 12,
                          color: colors.textSecondary,
                        }}
                      >
                        No active units
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
