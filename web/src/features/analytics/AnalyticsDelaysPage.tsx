import { useEffect, useState } from 'react';
import { Spin, Table, Tag, Typography, message } from 'antd';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsDelays } from '../../types';
import { AnalyticsPeriodNote } from './AnalyticsChrome';
import { formatInt, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;
const AXIS = { fontSize: 13, fill: '#334155' };
const HOURS = '#0f1c2e';
const OPEN = '#b45309';
const CLOSED = '#0f1c2e';
const CUMULATIVE = '#b45309';

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    END_OF_SHIFT: 'End of shift',
    BREAK: 'Break',
    MACHINE_DOWN: 'Machine down',
    WAITING_MATERIAL: 'Waiting for material',
    WAITING_PRIOR_OPERATION: 'Waiting on prior operation',
    OTHER: 'Other',
    MACHINE_DOWNTIME: 'Machine downtime',
    REWORK: 'Rework',
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

  const causeRows = (data.causes || []).map((r) => ({
    name: r.label || reasonLabel(r.cause),
    hours: r.hours ?? 0,
    share: r.shareOfTotalPct ?? 0,
    cumulative: r.cumulativePct ?? 0,
    count: r.occurrenceCount,
    causeType: r.causeType,
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

      <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
        Pareto of delay hours: pause reasons, machine downtime, and rework — sorted descending
        with cumulative share.
      </Text>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
        Breaks and end-of-shift pauses are normal non-working time and are not counted as delays
        {(() => {
          const ex = data.excludedNonWorkingPauses;
          if (!ex || !ex.totalHours) return '.';
          return ` (${(ex.totalHours ?? 0).toFixed(1)} h excluded: ${(ex.breakHours ?? 0).toFixed(1)} h breaks, ${(ex.endOfShiftHours ?? 0).toFixed(1)} h end of shift).`;
        })()}
      </Text>

      <Title level={5} style={{ marginTop: 0, color: '#0f1c2e' }}>
        Pareto analysis
      </Title>
      {causeRows.length === 0 ? (
        <Text type="secondary">No delay causes in this period.</Text>
      ) : (
        <>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              height: Math.max(320, causeRows.length * 28 + 120),
              marginBottom: 12,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={causeRows}
                margin={{ top: 8, right: 24, left: 8, bottom: 48 }}
              >
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={AXIS}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  yAxisId="hours"
                  tick={AXIS}
                  label={{
                    value: 'Hours',
                    angle: -90,
                    position: 'insideLeft',
                    style: AXIS,
                  }}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  domain={[0, 100]}
                  tick={AXIS}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: 'Cumulative %',
                    angle: 90,
                    position: 'insideRight',
                    style: AXIS,
                  }}
                />
                <Tooltip
                  contentStyle={{ fontSize: 13 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'hours') {
                      return [`${Number(value).toFixed(1)} h`, 'Hours'];
                    }
                    if (name === 'cumulative') {
                      return [`${Number(value).toFixed(1)}%`, 'Cumulative'];
                    }
                    return [value, name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar yAxisId="hours" dataKey="hours" name="Hours" fill={HOURS} barSize={28}>
                  <LabelList
                    dataKey="hours"
                    position="top"
                    formatter={(v: number) => `${Number(v).toFixed(1)}`}
                    style={{ fontSize: 11, fill: '#334155' }}
                  />
                </Bar>
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative %"
                  stroke={CUMULATIVE}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CUMULATIVE }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => `${r.causeType}-${r.name}`}
            style={{ marginBottom: 28 }}
            dataSource={causeRows}
            columns={[
              { title: 'Cause', dataIndex: 'name' },
              {
                title: 'Type',
                dataIndex: 'causeType',
                width: 110,
                render: (t: string) => (
                  <Tag>
                    {t === 'PAUSE'
                      ? 'Pause'
                      : t === 'DOWNTIME'
                        ? 'Downtime'
                        : t === 'REWORK'
                          ? 'Rework'
                          : t}
                  </Tag>
                ),
              },
              {
                title: 'Occurrences',
                dataIndex: 'count',
                width: 110,
                align: 'right',
                render: (v: number) => formatInt(v),
              },
              {
                title: 'Hours',
                dataIndex: 'hours',
                width: 100,
                align: 'right',
                render: (v: number) => `${v.toFixed(1)} h`,
              },
              {
                title: 'Share',
                dataIndex: 'share',
                width: 90,
                align: 'right',
                render: (v: number) => `${v.toFixed(1)}%`,
              },
              {
                title: 'Cumulative',
                dataIndex: 'cumulative',
                width: 110,
                align: 'right',
                render: (v: number) => `${v.toFixed(1)}%`,
              },
            ]}
          />
        </>
      )}

      <Title level={5} style={{ color: '#0f1c2e' }}>
        Pause reasons
      </Title>
      <Table
        size="small"
        pagination={false}
        rowKey="reason"
        style={{ marginBottom: 28 }}
        dataSource={data.pauseReasons}
        locale={{ emptyText: 'No pause events in this period.' }}
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
