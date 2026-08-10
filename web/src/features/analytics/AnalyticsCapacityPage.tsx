import { useEffect, useMemo, useState } from 'react';
import { Alert, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsDemandCapacity } from '../../types';
import { SummaryCard } from './AnalyticsChrome';
import { formatInt, formatNum, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const NORMAL = '#0f1c2e';
const CONSTRAINT = '#b45309';

export default function AnalyticsCapacityPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsDemandCapacity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.demandCapacity(params);
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

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.machineTypes]
      .sort((a, b) => (b.projectedLoadPct ?? 0) - (a.projectedLoadPct ?? 0))
      .map((t) => ({
        code: t.machineTypeCode,
        name: t.machineTypeName || t.machineTypeCode,
        units: t.activeUnitCount,
        pct: t.projectedLoadPct ?? 0,
        load: t.scheduledLoadHours ?? 0,
        avail: t.availableHours ?? 0,
        above: t.above80Pct,
        yLabel: `${t.machineTypeCode} (${t.activeUnitCount} unit${t.activeUnitCount === 1 ? '' : 's'})`,
      }));
  }, [data]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) return null;

  const constraints = rows.filter((r) => r.above);

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        Forward horizon {data.horizon.from} → {data.horizon.to} · {data.horizonWorkingDays}{' '}
        working days · {formatNum(data.availableHoursPerUnit, 0)}h available per unit. Load uses
        scheduled operations on open jobs; available hours = shop hours × active unit count.
      </Text>

      {data.thinSample ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="No scheduled operations in this horizon"
          description={
            data.thinSampleNote ||
            'Projected load is zero until open operations have scheduled windows.'
          }
        />
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <SummaryCard
          label="Scheduled ops in horizon"
          value={formatInt(data.scheduledOperationsInHorizon)}
        />
        <SummaryCard
          label="Hours per unit"
          value={formatNum(data.availableHoursPerUnit, 0)}
          hint={`${data.horizonWorkingDays} workdays × 9h`}
        />
        <SummaryCard
          label="Above 80% load"
          value={formatInt(constraints.length)}
          hint={
            constraints.length
              ? constraints.map((c) => c.code).join(', ')
              : 'no capacity flags'
          }
        />
      </div>

      <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e' }}>
        Projected load by machine type
      </Title>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        Amber bars and “constraint” labels mark types at or above 80%. Percentage and absolute
        hours are both shown — 88% on one unit differs from 30% across eight.
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '12px 8px 8px',
          height: Math.max(280, rows.length * 48 + 80),
          marginBottom: 16,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 8, right: 120, left: 8, bottom: 8 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]}
              tick={AXIS}
              tickFormatter={(v) => `${v}%`}
              label={{
                value: 'Projected load %',
                position: 'insideBottom',
                offset: -2,
                style: AXIS,
              }}
              height={40}
            />
            <YAxis type="category" dataKey="yLabel" width={150} tick={AXIS} />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number, _name, item) => {
                const row = item?.payload;
                if (!row) return [`${value.toFixed(1)}%`, 'Load'];
                return [
                  `${value.toFixed(1)}% · ${formatNum(row.load, 0)}h of ${formatNum(row.avail, 0)}h`,
                  row.above ? 'Constraint' : 'Load',
                ];
              }}
            />
            <ReferenceLine
              x={80}
              stroke="#b45309"
              strokeDasharray="4 4"
              label={{ value: '80%', position: 'top', fill: '#b45309', fontSize: 12 }}
            />
            <Bar dataKey="pct" barSize={18} radius={[0, 3, 3, 0]}>
              {rows.map((row) => (
                <Cell key={row.code} fill={row.above ? CONSTRAINT : NORMAL} />
              ))}
              <LabelList
                content={(props) => {
                  const { x, y, width, height, index } = props;
                  const row = rows[index as number];
                  if (!row || x == null || y == null || width == null || height == null) {
                    return null;
                  }
                  const label = `${row.pct.toFixed(1)}% · ${formatNum(row.load, 0)}h / ${formatNum(row.avail, 0)}h${
                    row.above ? ' · constraint' : ''
                  }`;
                  return (
                    <text
                      x={Number(x) + Number(width) + 8}
                      y={Number(y) + Number(height) / 2}
                      dy={4}
                      fill="#334155"
                      fontSize={12}
                    >
                      {label}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Table
        size="small"
        pagination={false}
        rowKey="code"
        dataSource={rows}
        rowClassName={(r) => (r.above ? 'analytics-capacity-constraint' : '')}
        columns={[
          { title: 'Machine type', dataIndex: 'code', width: 110 },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Active units',
            dataIndex: 'units',
            width: 100,
            align: 'right',
          },
          {
            title: 'Load hours',
            dataIndex: 'load',
            width: 100,
            align: 'right',
            render: (v: number) => formatNum(v, 1),
          },
          {
            title: 'Available hours',
            dataIndex: 'avail',
            width: 120,
            align: 'right',
            render: (v: number) => formatNum(v, 1),
          },
          {
            title: 'Projected load',
            dataIndex: 'pct',
            width: 120,
            align: 'right',
            render: (v: number, row) => (
              <span
                style={{
                  fontWeight: row.above ? 700 : 400,
                  color: row.above ? CONSTRAINT : undefined,
                }}
              >
                {v.toFixed(1)}%{row.above ? ' (constraint)' : ''}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
