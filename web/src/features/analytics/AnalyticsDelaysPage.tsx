import { useEffect, useState } from 'react';
import { Spin, Table, Tag, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsDelays } from '../../types';
import { AnalyticsPeriodNote } from './AnalyticsChrome';
import { formatInt, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;
const AXIS = { fontSize: 13, fill: '#334155' };
const HOURS = '#0f1c2e';
const COUNT = '#64748b';
const OPEN = '#b45309';
const CLOSED = '#0f1c2e';

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    END_OF_SHIFT: 'End of shift',
    BREAK: 'Break',
    MACHINE_DOWN: 'Machine down',
    WAITING_MATERIAL: 'Waiting for material',
    WAITING_PRIOR_OPERATION: 'Waiting on prior operation',
    OTHER: 'Other',
  };
  if (map[reason]) return map[reason];
  return reason
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export default function AnalyticsDelaysPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsDelays | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.delays(params);
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.from, params.to]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) return null;

  const pauseRows = data.pauseReasons.map((r) => ({
    reason: reasonLabel(r.reason),
    hours: r.totalPausedHours,
    count: r.occurrenceCount,
  }));

  const downtimeRows = data.machineDowntime.map((d) => ({
    name: d.machineUnitLabel || d.machineUnitId.slice(0, 8),
    hours: d.totalDowntimeHours ?? 0,
    count: d.occurrenceCount,
    open: d.openCount > 0,
    openCount: d.openCount,
    type: d.machineTypeCode,
  }));

  return (
    <div>
      <AnalyticsPeriodNote
        from={data.period.from}
        to={data.period.to}
        excludedOperationCount={data.excludedOperationCount}
      />

      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        Pause reasons and machine breakdowns show why jobs ran long — not only that they finished
        over target.
      </Text>

      <Title level={5} style={{ marginTop: 0, color: '#0f1c2e' }}>
        Pause reasons
      </Title>
      {pauseRows.length === 0 ? (
        <Text type="secondary">No pause events in this period.</Text>
      ) : (
        <>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              height: Math.max(260, pauseRows.length * 52 + 90),
              marginBottom: 12,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={pauseRows}
                margin={{ top: 8, right: 56, left: 8, bottom: 8 }}
              >
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS} />
                <YAxis type="category" dataKey="reason" width={170} tick={AXIS} />
                <Tooltip
                  contentStyle={{ fontSize: 13 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'hours') {
                      return [value == null ? '—' : `${Number(value).toFixed(1)} h`, 'Paused hours'];
                    }
                    return [value, 'Occurrences'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="hours" name="Paused hours" fill={HOURS} barSize={14}>
                  <LabelList
                    dataKey="hours"
                    position="right"
                    formatter={(v: number) => (v == null ? '—' : `${v.toFixed(1)}h`)}
                    style={{ fontSize: 11, fill: '#334155' }}
                  />
                </Bar>
                <Bar dataKey="count" name="Occurrences" fill={COUNT} barSize={14}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    style={{ fontSize: 11, fill: '#64748b' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
            Navy bars = total paused hours. Grey bars = occurrence count (not colour-only).
          </div>
        </>
      )}

      <Table
        size="small"
        pagination={false}
        rowKey="reason"
        style={{ marginBottom: 28 }}
        dataSource={data.pauseReasons}
        columns={[
          {
            title: 'Reason',
            dataIndex: 'reason',
            render: (r: string) => reasonLabel(r),
          },
          {
            title: 'Occurrences',
            dataIndex: 'occurrenceCount',
            width: 120,
            align: 'right',
            render: (v: number) => formatInt(v),
          },
          {
            title: 'Total paused hours',
            dataIndex: 'totalPausedHours',
            width: 160,
            align: 'right',
            render: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} h`),
          },
        ]}
      />

      <Title level={5} style={{ color: '#0f1c2e' }}>
        Machine breakdown by unit
      </Title>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        <span style={{ color: OPEN, fontWeight: 600 }}>Amber</span> = unit still has an open
        breakdown.{' '}
        <span style={{ color: CLOSED, fontWeight: 600 }}>Navy</span> = closed only. Open rows
        also show a Still down tag in the table.
      </div>
      {downtimeRows.length === 0 ? (
        <Text type="secondary">No machine breakdown records overlapping this period.</Text>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            height: Math.max(280, downtimeRows.length * 42 + 80),
            marginBottom: 12,
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={downtimeRows}
              margin={{ top: 8, right: 48, left: 8, bottom: 8 }}
            >
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS}
                label={{
                  value: 'Machine breakdown hours',
                  position: 'insideBottom',
                  offset: -2,
                  style: AXIS,
                }}
                height={40}
              />
              <YAxis type="category" dataKey="name" width={120} tick={AXIS} />
              <Tooltip
                contentStyle={{ fontSize: 13 }}
                formatter={(value: number) => [
                  `${Number(value).toFixed(1)} h`,
                  'Machine breakdown hours',
                ]}
                labelFormatter={(label, payload) => {
                  const row = payload?.[0]?.payload as
                    | { name: string; open: boolean; type?: string | null }
                    | undefined;
                  if (!row) return String(label);
                  return `${row.name}${row.open ? ' · still down' : ''} · ${row.type || ''}`;
                }}
              />
              <Bar dataKey="hours" name="Machine breakdown hours" barSize={16}>
                {downtimeRows.map((r) => (
                  <Cell key={r.name} fill={r.open ? OPEN : CLOSED} />
                ))}
                <LabelList
                  dataKey="hours"
                  position="right"
                  formatter={(v: number) => `${v.toFixed(1)}h`}
                  style={{ fontSize: 11, fill: '#334155' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Table
        size="small"
        pagination={false}
        rowKey="machineUnitId"
        dataSource={data.machineDowntime}
        columns={[
          {
            title: 'Unit',
            dataIndex: 'machineUnitLabel',
            render: (label: string | null, row) => (
              <span>
                {label || row.machineUnitId.slice(0, 8)}{' '}
                {row.openCount > 0 ? <Tag color="orange">Still down</Tag> : null}
              </span>
            ),
          },
          { title: 'Type', dataIndex: 'machineTypeCode', width: 100 },
          {
            title: 'Occurrences',
            dataIndex: 'occurrenceCount',
            width: 110,
            align: 'right',
          },
          {
            title: 'Machine breakdown hours',
            dataIndex: 'totalDowntimeHours',
            width: 170,
            align: 'right',
            render: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} h`),
          },
          {
            title: 'Still down',
            dataIndex: 'openCount',
            width: 72,
            align: 'right',
            render: (v: number) => (v > 0 ? <Tag color="orange">{v}</Tag> : '—'),
          },
        ]}
      />
    </div>
  );
}
