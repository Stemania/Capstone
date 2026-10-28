import { useEffect, useState } from 'react';
import { Alert, Radio, Space, Typography, message } from 'antd';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { personLabel } from '../../utils/people';
import { formatShop, formatShopDateTime } from '../../utils/shopTime';
import type { BreakdownAction, BreakdownWork } from '../../types';
import { FormModal } from '../../components/ui';
import { WarningOutlined } from '@ant-design/icons';

type Props = {
  work: BreakdownWork | null;
  /** Only an Admin changes the schedule; Office sees the list. */
  canDecide: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenSchedule: () => void;
};

function unitsText(work: BreakdownWork) {
  return work.otherUnits
    .map((u) => (u.operatorName ? `${u.label} (${u.operatorName})` : u.label))
    .join(', ');
}

/** After a breakdown: what to do with the unstarted work booked on the unit. */
export default function BreakdownWorkModal({ work, canDecide, onClose, onDone, onOpenSchedule }: Props) {
  const [action, setAction] = useState<BreakdownAction>('MOVE_UNIT');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (work) setAction(work.defaultAction ?? 'LEAVE');
  }, [work]);

  if (!work) return null;
  const count = work.operations.length;
  const repair = work.expectedRepairDate ? formatShop(work.expectedRepairDate, 'ddd D MMM') : null;

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await operationsApi.resolveBreakdownWork(work.machineUnitId, action);
      if (data.needsReplan.length) {
        message.warning(`Marked Needs re-plan: ${data.needsReplan.join(', ')}`);
      } else if (action === 'LEAVE') {
        message.info('Left as is. The board keeps flagging this work.');
      } else {
        const moved = data.moved.map((m) => m.jobNumber).join(', ');
        if (moved) message.success(`Moved ${moved}`);
        if (data.notPlaced.length) {
          message.warning(
            `Could not place ${data.notPlaced.map((m) => m.jobNumber).join(', ')}; marked Needs re-plan`
          );
        }
      }
      onDone();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      icon={<WarningOutlined />}
      title={`${count} operation${count === 1 ? '' : 's'} affected`}
      subtitle={`Booked on ${work.machineUnitLabel}, which is down. Choose what happens to this work.`}
      onCancel={onClose}
      onOk={canDecide ? submit : onOpenSchedule}
      okText={canDecide ? 'Apply' : 'Open Schedule'}
      cancelText={canDecide ? 'Decide later' : 'Close'}
      confirmLoading={saving}
      destroyOnHidden
    >
      <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
        {work.operations.map((op) => (
          <li key={op.id}>
            <Typography.Text strong>{op.jobNumber || 'Job'}</Typography.Text> · {op.operationName}
            {op.paused ? ' · paused, machine breakdown' : ''}
            {op.scheduledStart ? ` · ${formatShopDateTime(op.scheduledStart)}` : ''}
            {op.assignedWorkerName
              ? ` · ${personLabel(op.assignedWorkerName, op.assignedWorkerNickname)}`
              : ''}
          </li>
        ))}
      </ul>

      {work.needsReplan ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="Needs re-plan"
          description={`No other unit of this type is free and ${work.machineUnitLabel} has no expected repair date. Applying marks these jobs Needs re-plan so a person can decide.`}
        />
      ) : null}

      {canDecide ? (
        <Radio.Group value={action} onChange={(e) => setAction(e.target.value)}>
          <Space orientation="vertical">
            {!work.needsReplan ? (
              <>
                <Radio value="MOVE_UNIT" disabled={!work.canMoveToUnit}>
                  Move to another free unit of the same type
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {work.canMoveToUnit
                      ? `Earliest fit, preferring units with no operator or a free operator: ${unitsText(work)}`
                      : 'No other working unit of this type.'}
                  </div>
                </Radio>
                <Radio value="AFTER_REPAIR" disabled={!work.canMoveAfterRepair}>
                  Move after the expected repair date{repair ? ` (${repair})` : ''}
                  {!work.canMoveAfterRepair ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Set an expected repair date first.
                    </div>
                  ) : null}
                </Radio>
              </>
            ) : (
              <Radio value="MOVE_UNIT">Mark Needs re-plan</Radio>
            )}
            <Radio value="LEAVE">
              Leave as is
              <div style={{ fontSize: 12, color: '#64748b' }}>
                The board and Admin alerts keep flagging this work.
              </div>
            </Radio>
          </Space>
        </Radio.Group>
      ) : (
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          An Admin decides whether to move this work. Until then the board shows it on a down machine.
        </Typography.Paragraph>
      )}
    </FormModal>
  );
}
