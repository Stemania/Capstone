import { Button, DatePicker, Tag, Typography } from 'antd';
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
  scheduleApplied: boolean;
  warningsBySeq: Record<number, ScheduleWarning[]>;
  onChangeOp: (sequenceNo: number, patch: Partial<ProposedOperation>) => void;
  onBlurValidate: () => void;
  onApply: () => void;
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
      {flag} · {st.label}
    </span>
  );
}

export default function ScheduleProposalPanel({
  operations,
  projectedCompletion,
  scheduleFlag,
  scheduleApplied,
  warningsBySeq,
  onChangeOp,
  onBlurValidate,
  onApply,
}: Props) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: scheduleApplied ? '1.5px solid #2563eb' : '1px dashed #94a3b8',
        background: scheduleApplied ? '#eff6ff' : '#fff',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13, color: NAVY }}>
          Proposed schedule
        </Text>
        <FlagBadge flag={scheduleFlag} />
        {projectedCompletion && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Projected completion:{' '}
            <Text strong style={{ color: NAVY }}>
              {formatShopDateTime(projectedCompletion)}
            </Text>
            <span style={{ marginLeft: 4, fontSize: 11 }}>(Asia/Manila)</span>
          </Text>
        )}
        {scheduleApplied ? (
          <Tag color="blue" style={{ margin: 0 }}>
            Applied to form — save job to persist
          </Tag>
        ) : (
          <Tag style={{ margin: 0 }}>Preview only — not saved yet</Tag>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {operations.map((op) => {
          const warnings = warningsBySeq[op.sequenceNo] || [];
          return (
            <div
              key={op.sequenceNo}
              style={{
                padding: 10,
                borderRadius: 8,
                border: op.scheduled ? '1px solid #e2e8f0' : '1px solid #fecaca',
                background: op.scheduled ? '#fafafa' : '#fef2f2',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 12 }}>
                  #{op.sequenceNo} {op.operationName}
                </Text>
                {op.estimatedHoursDefaulted && (
                  <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                    1.0h assumed (no estimate given)
                  </Tag>
                )}
                {op.machineUnitLabel && (
                  <Tag style={{ margin: 0, fontSize: 11 }}>{op.machineUnitLabel}</Tag>
                )}
              </div>

              {!op.scheduled && op.message && (
                <Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  {op.message}
                </Text>
              )}

              {op.scheduled && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      Start (Manila)
                    </Text>
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format="MMM D, YYYY HH:mm"
                      size="small"
                      value={isoToShopDayjs(op.scheduledStart)}
                      onChange={(v) => {
                        onChangeOp(op.sequenceNo, {
                          scheduledStart: shopLocalToIso(v),
                        });
                      }}
                      onBlur={onBlurValidate}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      End (Manila)
                    </Text>
                    <DatePicker
                      showTime={{ format: 'HH:mm' }}
                      format="MMM D, YYYY HH:mm"
                      size="small"
                      value={isoToShopDayjs(op.scheduledEnd)}
                      onChange={(v) => {
                        onChangeOp(op.sequenceNo, {
                          scheduledEnd: shopLocalToIso(v),
                        });
                      }}
                      onBlur={onBlurValidate}
                    />
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {warnings.map((w, i) => (
                    <Tag key={`${w.code}-${i}`} color="warning" style={{ margin: 0, fontSize: 11 }}>
                      {w.message}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          onClick={onApply}
          disabled={scheduleApplied || !operations.some((o) => o.scheduled)}
          style={{ background: NAVY, borderColor: NAVY, fontWeight: 600 }}
        >
          Apply Schedule to Job
        </Button>
      </div>
    </div>
  );
}
