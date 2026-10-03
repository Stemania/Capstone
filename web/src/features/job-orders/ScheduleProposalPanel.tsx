import { Button, DatePicker, Select, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { MachineUnitInfo, ProposedOperation, ScheduleFlag, ScheduleProblem } from '../../types';
import {
  formatShopDateTime,
  isoToShopDayjs,
  scheduleFlagStyle,
  shopLocalToIso,
} from '../../utils/shopTime';

const { Text } = Typography;
const NAVY = '#0f1c2e';

type Props = {
  operations: ProposedOperation[];
  machineUnits: MachineUnitInfo[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
  problemsBySeq: Record<number, ScheduleProblem[]>;
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

function FlagBadge({ flag }: { flag: ScheduleFlag | null | undefined }) {
  if (!flag) return null;
  const st = scheduleFlagStyle[flag];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        color: st.color,
        background: st.bg,
        border: `1px solid ${st.border}`,
      }}
    >
      {st.label}
    </span>
  );
}

function unitsForOp(op: ProposedOperation, units: MachineUnitInfo[]) {
  if (!op.machineTypeId) return [];
  return units
    .filter((u) => u.machineTypeId === op.machineTypeId && u.active !== false)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default function ScheduleProposalPanel({
  operations,
  machineUnits,
  projectedCompletion,
  scheduleFlag,
  problemsBySeq,
  onChangeOp,
  onMachineUnitChange,
  onRefreshProposal,
  refreshing = false,
  readOnly = false,
}: Props) {
  return (
    <div className="jo-plan__schedule">
      <div className="jo-plan__schedule-meta">
        <div className="jo-plan__schedule-meta-main">
          <Text strong style={{ fontSize: 13, color: NAVY }}>
            Proposed schedule
          </Text>
          <FlagBadge flag={scheduleFlag} />
          {projectedCompletion ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Expected completion:{' '}
              <Text strong style={{ color: NAVY }}>
                {formatShopDateTime(projectedCompletion)}
              </Text>
            </Text>
          ) : null}
        </div>
        <div className="jo-plan__schedule-meta-aside">
          <Tag style={{ margin: 0 }}>Edits update the week view live — not saved until you confirm</Tag>
          {onRefreshProposal && !readOnly ? (
            <Tooltip title="Reset to proposed schedule">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={onRefreshProposal}
                aria-label="Reset to proposed schedule"
                className="jo-plan__schedule-refresh"
              />
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="jo-plan__schedule-table">
        <div className="jo-plan__schedule-row jo-plan__schedule-row--head">
          <div className="jo-plan__schedule-op">Operation</div>
          <div className="jo-plan__schedule-field">Machine unit</div>
          <div className="jo-plan__schedule-field">Start</div>
          <div className="jo-plan__schedule-field">End</div>
        </div>

        {operations.map((op) => {
          const problems = problemsBySeq[op.sequenceNo] || [];
          const unitOptions = unitsForOp(op, machineUnits);
          const needsMachine = Boolean(op.machineTypeId);

          return (
            <div
              key={op.sequenceNo}
              className={`jo-plan__schedule-row${op.scheduled ? '' : ' jo-plan__schedule-row--error'}`}
            >
              <div className="jo-plan__schedule-op">
                <Text strong style={{ fontSize: 12 }}>
                  #{op.sequenceNo} {op.operationName}
                </Text>
                <div className="jo-plan__schedule-tags">
                  {op.estimatedHoursDefaulted ? (
                    <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                      1.0h assumed
                    </Tag>
                  ) : null}
                </div>
                {!op.scheduled && op.message ? (
                  <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {op.message}
                  </Text>
                ) : null}
                {op.scheduled && op.message ? (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {op.message}
                  </Text>
                ) : null}
                {problems.length > 0 ? (
                  <div className="jo-plan__schedule-tags" style={{ marginTop: 4 }}>
                    {problems.map((p, i) => (
                      <Tag
                        key={`${p.code}-${i}`}
                        color="error"
                        style={{ margin: 0, fontSize: 11, whiteSpace: 'normal' }}
                      >
                        {p.message}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="jo-plan__schedule-field" data-label="Machine unit">
                {needsMachine ? (
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="Select unit"
                    allowClear
                    disabled={readOnly}
                    value={op.machineUnitId || undefined}
                    options={unitOptions.map((u) => ({ value: u.id, label: u.label }))}
                    onChange={(unitId) => {
                      const unit = unitOptions.find((u) => u.id === unitId);
                      const machineUnitId = unitId || null;
                      const machineUnitLabel = unit?.label || null;
                      if (onMachineUnitChange) {
                        onMachineUnitChange(op.sequenceNo, machineUnitId, machineUnitLabel);
                      } else {
                        onChangeOp(op.sequenceNo, {
                          machineUnitId,
                          machineUnitLabel,
                        });
                      }
                    }}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    No machine
                  </Text>
                )}
              </div>

              {op.scheduled ? (
                <>
                  <div className="jo-plan__schedule-field" data-label="Start">
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format="MMM D, YYYY HH:mm"
                      size="small"
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      value={isoToShopDayjs(op.scheduledStart)}
                      allowClear={false}
                      onChange={(v) => {
                        if (!v) return;
                        onChangeOp(op.sequenceNo, {
                          scheduledStart: shopLocalToIso(v),
                        });
                      }}
                    />
                  </div>
                  <div className="jo-plan__schedule-field" data-label="End">
                    <Tooltip title="Worked out from Start and the target hours, across working hours, overtime and holidays. Change the target hours in the Operations step.">
                      <Text style={{ fontSize: 12, color: NAVY }}>
                        {op.scheduledEnd ? isoToShopDayjs(op.scheduledEnd)?.format('MMM D, YYYY HH:mm') : '—'}
                      </Text>
                    </Tooltip>
                  </div>
                </>
              ) : (
                <div className="jo-plan__schedule-field jo-plan__schedule-field--empty" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
