import { Button, DatePicker, Select, Tooltip } from 'antd';
import { ReloadOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatusPill from '../../components/StatusPill';
import { SCHEDULE_FLAG_TONE } from '../../theme/statuses';
import type { MachineUnitInfo, ProposedOperation, ScheduleFlag, ScheduleProblem } from '../../types';
import { fasterUnitText, unitPairText } from './unitPairing';
import {
  SHOP_TZ,
  formatShop,
  isoToShopDayjs,
  scheduleFlagStyle,
  shopLocalToIso,
} from '../../utils/shopTime';

const DATE_TIME = 'MMM D, YYYY HH:mm';

type Props = {
  operations: ProposedOperation[];
  machineUnits: MachineUnitInfo[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
  /** Date required (YYYY-MM-DD); rows that end after it are flagged. */
  dueDate?: string | null;
  problemsBySeq: Record<number, ScheduleProblem[]>;
  /** Shown in amber; never block confirming. */
  warningsBySeq?: Record<number, ScheduleProblem[]>;
  onChangeOp: (sequenceNo: number, patch: Partial<ProposedOperation>) => void;
  /** Machine change should re-fit start/end on the selected unit. */
  onMachineUnitChange?: (
    sequenceNo: number,
    machineUnitId: string | null,
    machineUnitLabel: string | null
  ) => void;
  /** Re-run earliest-fit proposal (reset manual date/time edits). */
  onRefreshProposal?: () => void;
  refreshing?: boolean;
  readOnly?: boolean;
};

function unitsForOp(op: ProposedOperation, units: MachineUnitInfo[]) {
  if (!op.machineTypeId) return [];
  return units
    .filter((u) => u.machineTypeId === op.machineTypeId && u.active !== false)
    .sort((a, b) => a.label.localeCompare(b.label));
}

const shopDate = (iso?: string | null) => (iso ? dayjs(iso).tz(SHOP_TZ).format('YYYY-MM-DD') : null);

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Bars from the first start to the later of the last end and the date required. */
function MiniTimeline({
  operations,
  dueDate,
  lateSeqs,
}: {
  operations: ProposedOperation[];
  dueDate?: string | null;
  lateSeqs: Set<number>;
}) {
  const ops = operations.filter((op) => op.scheduled && op.scheduledStart && op.scheduledEnd);
  if (!ops.length) return null;
  const dueEnd = dueDate ? dayjs.tz(`${dueDate} 23:59:59`, SHOP_TZ).valueOf() : null;
  const start = Math.min(...ops.map((op) => dayjs(op.scheduledStart!).valueOf()));
  const end = Math.max(...ops.map((op) => dayjs(op.scheduledEnd!).valueOf()), dueEnd ?? 0);
  const span = Math.max(end - start, 1);
  const pct = (t: number) => `${(((t - start) / span) * 100).toFixed(2)}%`;
  return (
    <div className="jo-tl" aria-label="Timeline of the proposed schedule">
      <div className="jo-tl__scale">
        <span>{formatShop(new Date(start).toISOString(), 'MMM D')}</span>
        <span>{formatShop(new Date(end).toISOString(), 'MMM D')}</span>
      </div>
      <div className="jo-tl__rows">
        {dueEnd ? (
          <div className="jo-tl__overlay" aria-hidden>
            <div
              className={`jo-tl__due${(dueEnd - start) / span > 0.85 ? ' is-end' : (dueEnd - start) / span < 0.15 ? ' is-start' : ''}`}
              style={{ left: pct(dueEnd) }}
            >
              <span>Due {formatShop(dueDate, 'MMM D')}</span>
            </div>
          </div>
        ) : null}
        {ops.map((op) => {
          const s = dayjs(op.scheduledStart!).valueOf();
          const e = dayjs(op.scheduledEnd!).valueOf();
          return (
            <div key={op.sequenceNo} className="jo-tl__row">
              <span className="jo-tl__label">
                {op.sequenceNo}. {op.operationName}
              </span>
              <span className="jo-tl__track">
                <Tooltip
                  title={`${formatShop(op.scheduledStart, DATE_TIME)} – ${formatShop(op.scheduledEnd, DATE_TIME)}`}
                >
                  <span
                    className={`jo-tl__bar${lateSeqs.has(op.sequenceNo) ? ' is-late' : ''}`}
                    style={{ left: pct(s), width: `max(4px, calc(${pct(e)} - ${pct(s)}))` }}
                  />
                </Tooltip>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ScheduleProposalPanel({
  operations,
  machineUnits,
  projectedCompletion,
  scheduleFlag,
  dueDate,
  problemsBySeq,
  warningsBySeq = {},
  onChangeOp,
  onMachineUnitChange,
  onRefreshProposal,
  refreshing = false,
  readOnly = false,
}: Props) {
  const lateSeqs = new Set(
    operations
      .filter((op) => dueDate && op.scheduled && (shopDate(op.scheduledEnd) || '') > dueDate)
      .map((op) => op.sequenceNo),
  );
  const firstLate = Math.min(...lateSeqs);
  const finishDate = shopDate(projectedCompletion);
  const daysLate =
    finishDate && dueDate ? Math.max(0, dayjs(finishDate).diff(dayjs(dueDate), 'day')) : 0;
  const flag = scheduleFlag ? scheduleFlagStyle[scheduleFlag] : null;

  return (
    <div className="jo-sched">
      <div className="jo-sched__summary">
        <div className="jo-sched__kpi">
          <span className="jo-sched__kpi-label">Expected completion</span>
          <span className={`jo-sched__kpi-value${daysLate > 0 ? ' is-late' : ''}`}>
            {projectedCompletion ? formatShop(projectedCompletion, DATE_TIME) : '—'}
          </span>
        </div>
        <div className="jo-sched__kpi">
          <span className="jo-sched__kpi-label">Date required</span>
          <span className="jo-sched__kpi-value">{dueDate ? formatShop(dueDate, 'MMM D, YYYY') : '—'}</span>
        </div>
        {flag && scheduleFlag ? (
          <StatusPill tone={SCHEDULE_FLAG_TONE[scheduleFlag]} dot>
            {daysLate > 0 ? `${plural(daysLate, 'day')} late` : flag.label}
          </StatusPill>
        ) : null}
        <div className="jo-sched__aside">
          <span className="jo-sched__note">Not saved until you confirm</span>
          {onRefreshProposal && !readOnly ? (
            <Tooltip title="Reset to the proposed schedule">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={onRefreshProposal}
                aria-label="Reset to the proposed schedule"
                className="jo-sched__refresh"
              />
            </Tooltip>
          ) : null}
        </div>
      </div>

      <MiniTimeline operations={operations} dueDate={dueDate} lateSeqs={lateSeqs} />

      <div className="jo-sched__table">
        <div className="jo-sched__row jo-sched__row--head">
          <div>Operation</div>
          <div>Machine unit</div>
          <div>Start</div>
          <div>End</div>
        </div>

        {operations.map((op, idx) => {
          const problems = problemsBySeq[op.sequenceNo] || [];
          const warnings = warningsBySeq[op.sequenceNo] || [];
          const unitOptions = unitsForOp(op, machineUnits);
          const faster = op.fasterUnit;
          const needsMachine = Boolean(op.machineTypeId);
          const late = lateSeqs.has(op.sequenceNo);
          const prevOp = idx > 0 ? operations[idx - 1] : null;
          const earliestStart = prevOp?.scheduledEnd
            ? isoToShopDayjs(prevOp.scheduledEnd)
            : null;

          return (
            <div
              key={op.sequenceNo}
              className={`jo-sched__row${op.scheduled ? '' : ' is-error'}${late ? ' is-late' : ''}`}
            >
              <div className="jo-sched__op">
                <span className="jo-sched__seq">{op.sequenceNo}</span>
                <div className="jo-sched__op-main">
                  <span className="jo-sched__op-name">{op.operationName}</span>
                  <div className="jo-sched__tags">
                    {op.isOutsourced ? (
                      <StatusPill tone="indigo" compact>
                        Outsourced · {plural(op.turnaroundDays ?? 0, 'day')}
                      </StatusPill>
                    ) : op.estimatedHoursDefaulted ? (
                      <StatusPill tone="slate" compact>
                        1.0h assumed
                      </StatusPill>
                    ) : null}
                    {late && op.sequenceNo === firstLate ? (
                      <StatusPill tone="red" compact>
                        <WarningFilled /> Pushes past {formatShop(dueDate, 'MMM D')}
                      </StatusPill>
                    ) : null}
                  </div>
                  {op.message ? (
                    <div className={`jo-sched__msg${op.scheduled ? '' : ' is-error'}`}>{op.message}</div>
                  ) : null}
                  {problems.length > 0 ? (
                    <div className="jo-sched__tags">
                      {problems.map((p, i) => (
                        <StatusPill key={`${p.code}-${i}`} tone="red" compact>
                          {p.message}
                        </StatusPill>
                      ))}
                    </div>
                  ) : null}
                  {warnings.length > 0 ? (
                    <div className="jo-sched__tags">
                      {warnings.map((p, i) => (
                        <StatusPill key={`${p.code}-${i}`} tone="amber" compact>
                          {p.message}
                        </StatusPill>
                      ))}
                    </div>
                  ) : null}
                  {faster && !readOnly ? (
                    <div className="jo-sched__faster">
                      <span>{fasterUnitText(faster, (iso) => formatShop(iso, 'MMM D'))}</span>
                      <Button
                        size="small"
                        onClick={() => {
                          const label = faster.machineUnitLabel || null;
                          if (onMachineUnitChange) onMachineUnitChange(op.sequenceNo, faster.machineUnitId, label);
                          else onChangeOp(op.sequenceNo, { machineUnitId: faster.machineUnitId, machineUnitLabel: label });
                        }}
                      >
                        Use {faster.machineUnitLabel || 'this unit'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="jo-sched__field" data-label="Machine unit">
                {needsMachine ? (
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="Select unit"
                    allowClear
                    disabled={readOnly}
                    value={op.machineUnitId || undefined}
                    options={unitOptions.map((u) => ({
                      value: u.id,
                      label: unitPairText(u, op.assignedWorkerId) || u.label,
                    }))}
                    onChange={(unitId) => {
                      const unit = unitOptions.find((u) => u.id === unitId);
                      const machineUnitId = unitId || null;
                      const machineUnitLabel = unit?.label || null;
                      if (onMachineUnitChange) {
                        onMachineUnitChange(op.sequenceNo, machineUnitId, machineUnitLabel);
                      } else {
                        onChangeOp(op.sequenceNo, { machineUnitId, machineUnitLabel });
                      }
                    }}
                  />
                ) : (
                  <span className="jo-sched__muted">{op.isOutsourced ? 'Outside shop' : 'No machine'}</span>
                )}
              </div>

              {op.scheduled ? (
                <>
                  <div className="jo-sched__field" data-label="Start">
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format={DATE_TIME}
                      size="small"
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      value={isoToShopDayjs(op.scheduledStart)}
                      allowClear={false}
                      disabledDate={(d) =>
                        Boolean(earliestStart && d && d.endOf('day').isBefore(earliestStart))
                      }
                      disabledTime={(d) => {
                        if (!earliestStart || !d || !d.isSame(earliestStart, 'day')) {
                          return {};
                        }
                        const h0 = earliestStart.hour();
                        const m0 = earliestStart.minute();
                        return {
                          disabledHours: () =>
                            Array.from({ length: h0 }, (_, i) => i),
                          disabledMinutes: (h) =>
                            h === h0 ? Array.from({ length: m0 }, (_, i) => i) : [],
                        };
                      }}
                      onChange={(v) => {
                        if (!v) return;
                        const next =
                          earliestStart && v.isBefore(earliestStart) ? earliestStart : v;
                        onChangeOp(op.sequenceNo, { scheduledStart: shopLocalToIso(next) });
                      }}
                    />
                    {earliestStart ? (
                      <div className="jo-sched__muted" style={{ fontSize: 11, marginTop: 2 }}>
                        Earliest: {earliestStart.format(DATE_TIME)}
                      </div>
                    ) : null}
                  </div>
                  <div className="jo-sched__field" data-label="End">
                    <Tooltip
                      title={
                        op.isOutsourced
                          ? 'Start plus the turnaround in calendar days. The next operation waits until it is returned.'
                          : 'Worked out from Start and the target hours, across working hours, overtime and holidays. Change the target hours in the Operations step.'
                      }
                    >
                      <span className={`jo-sched__end${late ? ' is-late' : ''}`}>
                        {op.scheduledEnd ? formatShop(op.scheduledEnd, DATE_TIME) : '—'}
                      </span>
                    </Tooltip>
                  </div>
                </>
              ) : (
                <div className="jo-sched__field jo-sched__field--empty" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
