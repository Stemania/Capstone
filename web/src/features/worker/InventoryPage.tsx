import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Segmented, message } from 'antd';
import { DownOutlined, ExperimentOutlined, RightOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { EmptyState, PageSkeleton, StatusPill } from '../../components/ui';
import { formatShop } from '../../utils/shopTime';
import type { Tone } from '../../theme/tokens';
import type { Tool, ToolType, ToolUnit, ToolUnitStatus } from '../../types';
import { TOOLS_CHANGED, announceToolsChanged } from './toolsEvents';

type Tab = 'tools' | 'consumables';
type ToolView = 'holding' | 'all';

const UNIT_STATUS: Record<ToolUnitStatus, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'On rack', tone: 'green' },
  OUT: { label: 'Out', tone: 'amber' },
  UNDER_REPAIR: { label: 'Repair', tone: 'red' },
  RETIRED: { label: 'Retired', tone: 'slate' },
};

function qty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('tools');
  const [view, setView] = useState<ToolView>('holding');
  const [query, setQuery] = useState('');
  const [held, setHeld] = useState<ToolUnit[]>([]);
  const [types, setTypes] = useState<ToolType[]>([]);
  const [consumables, setConsumables] = useState<Tool[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const loadTools = async () => {
    try {
      const [h, t] = await Promise.all([toolsApi.myTools(), toolsApi.listTypes({ includeUnits: true })]);
      setHeld(h.data);
      setTypes(t.data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTools();
    const onChange = () => void loadTools();
    window.addEventListener(TOOLS_CHANGED, onChange);
    return () => window.removeEventListener(TOOLS_CHANGED, onChange);
  }, []);

  useEffect(() => {
    if (tab !== 'consumables' || consumables) return;
    toolsApi
      .list({ category: 'CONSUMABLE' })
      .then(({ data }) => setConsumables(data))
      .catch((err) => {
        message.error(getErrorMessage(err));
        setConsumables([]);
      });
  }, [tab, consumables]);

  const handleReturn = async (unit: ToolUnit) => {
    setReturning(unit.id);
    try {
      await toolsApi.scan(unit.assetCode, { intent: 'RETURN' });
      message.success(`Returned: ${unit.toolTypeName} (${unit.assetCode})`);
      announceToolsChanged();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setReturning(null);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredHeld = useMemo(
    () =>
      q
        ? held.filter((t) => (t.toolTypeName || '').toLowerCase().includes(q) || t.assetCode.toLowerCase().includes(q))
        : held,
    [held, q]
  );
  const filteredTypes = useMemo(
    () =>
      q
        ? types.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.code.toLowerCase().includes(q) ||
              (t.units || []).some(
                (u) => u.assetCode.toLowerCase().includes(q) || (u.currentHolderName || '').toLowerCase().includes(q)
              )
          )
        : types,
    [types, q]
  );
  const filteredConsumables = useMemo(
    () =>
      (consumables || []).filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          (c.shopTerm || '').toLowerCase().includes(q) ||
          (c.sizeSpec || '').toLowerCase().includes(q)
      ),
    [consumables, q]
  );
  const totalUnits = types.reduce((sum, t) => sum + (t.totalUnits || 0), 0);
  const lowCount = (consumables || []).filter((c) => c.lowStock).length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderHolding = () =>
    filteredHeld.length === 0 ? (
      <EmptyState
        compact
        icon={<ToolOutlined />}
        title={q ? 'No tools match your search' : 'No tools out with you'}
        description={q ? undefined : "Scan a tool's QR code to borrow it."}
      />
    ) : (
      <div className="w-card w-card--flush">
        <div className="w-rows">
          {filteredHeld.map((unit) => (
            <div key={unit.id} className="w-row" style={{ cursor: 'default', minHeight: 68 }}>
              <span className="w-row__icon">
                <ToolOutlined />
              </span>
              <div className="w-row__main">
                <div className="w-row__title">{unit.toolTypeName}</div>
                <div className="w-row__sub">
                  {unit.assetCode}
                  {unit.heldSince ? ` · since ${formatShop(unit.heldSince, 'MMM D, h:mm A')}` : ''}
                </div>
              </div>
              <Button
                className="w-action--sm"
                loading={returning === unit.id}
                onClick={() => handleReturn(unit)}
              >
                Return
              </Button>
            </div>
          ))}
        </div>
      </div>
    );

  const renderAll = () =>
    filteredTypes.length === 0 ? (
      <EmptyState compact icon={<SearchOutlined />} title="No tools match your search" />
    ) : (
      <div className="w-card w-card--flush">
        <div className="w-rows">
          {filteredTypes.map((type) => {
            const units = (type.units || []).filter((u) => u.status !== 'RETIRED');
            const available = type.availableCount ?? 0;
            const out = type.outCount ?? 0;
            const repair = type.repairCount ?? 0;
            const open = expanded.has(type.id);
            return (
              <div key={type.id} className="w-tooltype">
                <button
                  type="button"
                  className="w-row"
                  style={{ borderTop: 0 }}
                  onClick={() => toggle(type.id)}
                  aria-expanded={open}
                >
                  <span className="w-row__icon">
                    <ToolOutlined />
                  </span>
                  <div className="w-row__main">
                    <div className="w-row__title">{type.name}</div>
                    <div className="w-row__sub">
                      <b style={{ color: available ? 'var(--tone-green-fg)' : 'var(--c-text-muted)' }}>
                        {available} available
                      </b>
                      {out ? ` · ${out} out` : ''}
                      {repair ? ` · ${repair} in repair` : ''}
                    </div>
                  </div>
                  {open ? <DownOutlined className="w-row__chev" /> : <RightOutlined className="w-row__chev" />}
                </button>
                {open && (
                  <div className="w-units">
                    {units.length === 0 ? (
                      <div className="w-unit__who">No active units</div>
                    ) : (
                      units.map((u) => {
                        const st = UNIT_STATUS[u.status] || { label: u.status, tone: 'slate' as Tone };
                        return (
                          <div key={u.id} className="w-unit">
                            <div style={{ minWidth: 0 }}>
                              <div className="w-unit__code">{u.assetCode}</div>
                              {u.status === 'OUT' && (
                                <div className="w-unit__who">
                                  {u.currentHolderName ? `With ${u.currentHolderName}` : 'Out'}
                                </div>
                              )}
                            </div>
                            <StatusPill tone={st.tone} compact>
                              {st.label}
                            </StatusPill>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );

  const renderConsumables = () =>
    !consumables ? (
      <PageSkeleton variant="list" />
    ) : filteredConsumables.length === 0 ? (
      <EmptyState
        compact
        icon={<ExperimentOutlined />}
        title={q ? 'No consumables match your search' : 'No consumables listed yet'}
      />
    ) : (
      <>
        <div className="w-card w-card--flush">
          <div className="w-rows">
            {filteredConsumables.map((c) => (
              <div key={c.id} className="w-row" style={{ cursor: 'default' }}>
                <div className="w-row__main">
                  <div className="w-row__title">
                    {c.name}
                    {c.shopTerm ? <span className="w-muted" style={{ fontWeight: 500 }}> · {c.shopTerm}</span> : null}
                  </div>
                  <div className="w-row__sub">
                    {[c.sizeSpec, c.code].filter(Boolean).join(' · ')}
                  </div>
                  {c.lowStock && (
                    <div style={{ marginTop: 4 }}>
                      <StatusPill tone="amber" compact>
                        Low stock
                      </StatusPill>
                    </div>
                  )}
                </div>
                <div className="w-stock">
                  <div className="w-stock__qty">{qty(c.quantityOnHand)}</div>
                  <div className="w-stock__unit">{c.unit || 'pcs'} on hand</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="w-note" style={{ padding: '0 4px' }}>
          Take what you need, then scan the consumable QR on the Scan page (−1 each time). Tell the
          office if something looks wrong on the shelf.
        </div>
      </>
    );

  return (
    <div>
      <WorkerPageHeader
        title="Inventory"
        subtitle={
          tab === 'tools'
            ? `${held.length} with you · ${totalUnits} tool units`
            : consumables
              ? `${consumables.length} items${lowCount ? ` · ${lowCount} low` : ''}`
              : 'Consumables'
        }
      />
      <div className="w-page">
        <div className="w-toolbar">
          <Segmented
            block
            className="worker-seg"
            value={tab}
            onChange={(v) => {
              setTab(v as Tab);
              setQuery('');
            }}
            options={[
              { label: 'Tools', value: 'tools' },
              { label: 'Consumables', value: 'consumables' },
            ]}
          />
          {tab === 'tools' && (
            <div className="w-chips" role="tablist" aria-label="Which tools">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'holding'}
                className={`w-chip${view === 'holding' ? ' is-active' : ''}`}
                onClick={() => setView('holding')}
              >
                Holding ({held.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'all'}
                className={`w-chip${view === 'all' ? ' is-active' : ''}`}
                onClick={() => setView('all')}
              >
                All tools ({totalUnits})
              </button>
            </div>
          )}
          <Input
            allowClear
            className="worker-search"
            prefix={<SearchOutlined style={{ color: 'var(--c-text-muted)' }} />}
            placeholder={tab === 'consumables' ? 'Search consumables' : view === 'all' ? 'Search tools or holder' : 'Search your tools'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {tab === 'consumables'
          ? renderConsumables()
          : loading
            ? <PageSkeleton variant="list" />
            : view === 'holding'
              ? renderHolding()
              : renderAll()}
      </div>
    </div>
  );
}
