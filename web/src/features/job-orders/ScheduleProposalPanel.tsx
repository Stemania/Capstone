import { DatePicker, Tag, Typography } from 'antd';
import type { ProposedOperation, ScheduleFlag, ScheduleWarning } from '../../types';
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
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
  warningsBySeq: Record<number, ScheduleWarning[]>;
  onChangeOp: (sequenceNo: number, patch: Partial<ProposedOperation>) => void;
  onBlurValidate: () => void;
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

export default function ScheduleProposalPanel({
  operations,
  projectedCompletion,
  scheduleFlag,
  warningsBySeq,
  onChangeOp,
  onBlurValidate,
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
        <Tag style={{ margin: 0 }}>Preview only — not saved yet</Tag>
      </div>

      <div className="jo-plan__schedule-table">
        <div className="jo-plan__schedule-row jo-plan__schedule-row--head">
          <div className="jo-plan__schedule-op">Operation</div>
          <div className="jo-plan__schedule-field">Start</div>
          <div className="jo-plan__schedule-field">End</div>
        </div>

        {operations.map((op) => {
          const warnings = warningsBySeq[op.sequenceNo] || [];
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
                  {op.machineUnitLabel ? (
                    <Tag style={{ margin: 0, fontSize: 11 }}>{op.machineUnitLabel}</Tag>
                  ) : null}
                </div>
                {!op.scheduled && op.message ? (
                  <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {op.message}
                  </Text>
                ) : null}
                {warnings.length > 0 ? (
                  <div className="jo-plan__schedule-tags" style={{ marginTop: 4 }}>
                    {warnings.map((w, i) => (
                      <Tag key={`${w.code}-${i}`} color="warning" style={{ margin: 0, fontSize: 11 }}>
                        {w.message}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>

              {op.scheduled ? (
                <>
                  <div className="jo-plan__schedule-field" data-label="Start">
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format="MMM D, YYYY HH:mm"
                      size="small"
                      style={{ width: '100%' }}
                      value={isoToShopDayjs(op.scheduledStart)}
                      onChange={(v) => {
                        onChangeOp(op.sequenceNo, {
                          scheduledStart: shopLocalToIso(v),
                        });
                      }}
                      onBlur={onBlurValidate}
                    />
                  </div>
                  <div className="jo-plan__schedule-field" data-label="End">
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format="MMM D, YYYY HH:mm"
                      size="small"
                      style={{ width: '100%' }}
                      value={isoToShopDayjs(op.scheduledEnd)}
                      onChange={(v) => {
                        onChangeOp(op.sequenceNo, {
                          scheduledEnd: shopLocalToIso(v),
                        });
                      }}
                      onBlur={onBlurValidate}
                    />
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
