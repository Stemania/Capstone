import { Dropdown } from 'antd';
import { MoreOutlined, TeamOutlined } from '@ant-design/icons';
import { PersonAvatar } from '../../components/PersonAvatar';
import { IdChip, StatusPill } from '../../components/ui';
import { MACHINE_STATUS } from '../../theme/statuses';
import { personLabel } from '../../utils/people';
import type { MachineUnitStatus } from '../../types';
import { machineArt, type MachineKind } from './machineKinds';
import {
  cardStatus,
  formatOpenDuration,
  machineMenuItems,
  runnerIfOther,
  whenLabel,
  type MachineActions,
} from './machineStatus';

function Person({
  id,
  fullName,
  nickname,
  photoVersion,
  size,
}: {
  id?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  photoVersion?: number | null;
  size: number;
}) {
  return (
    <span className="mcard__person">
      <PersonAvatar userId={id} fullName={fullName} photoVersion={photoVersion} size={size} />
      <span className="mcard__person-name">{personLabel(fullName, nickname)}</span>
    </span>
  );
}

export default function MachineCard({
  unit,
  kind,
  nowMs,
  actions,
}: {
  unit: MachineUnitStatus;
  kind: MachineKind;
  nowMs: number;
  actions: MachineActions;
}) {
  const status = cardStatus(unit);
  const cur = unit.currentOperation;
  const runner = runnerIfOther(unit);
  const down = unit.openDowntime;
  const open = () => actions.onDetails?.(unit);

  return (
    <article
      className={`mcard mcard--${status}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${unit.label}, ${MACHINE_STATUS[status].label}. Open details`}
    >
      <header className="mcard__head">
        <h3 className="mcard__name">{unit.label}</h3>
        <StatusPill status={status} map={MACHINE_STATUS} compact dot />
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Dropdown menu={{ items: machineMenuItems(unit, actions) }} trigger={['click']} placement="bottomRight">
            <button type="button" className="mcard__menu" aria-label={`${unit.label} actions`}>
              <MoreOutlined />
            </button>
          </Dropdown>
        </span>
      </header>

      <div className="mcard__main">
        <div className="mcard__art" data-kind={kind}>
          <img src={machineArt(kind)} alt="" draggable={false} />
        </div>
        <div className="mcard__who">
          <div className="mcard__caption">Assigned</div>
          {unit.defaultOperatorId ? (
            <Person
              id={unit.defaultOperatorId}
              fullName={unit.defaultOperatorName}
              nickname={unit.defaultOperatorNickname}
              photoVersion={unit.defaultOperatorPhotoVersion}
              size={36}
            />
          ) : (
            <span className="mcard__person mcard__person--open">
              <span className="mcard__open-icon" aria-hidden>
                <TeamOutlined />
              </span>
              <span className="mcard__person-name">Open to all</span>
            </span>
          )}
          {runner && status !== 'breakdown' && (
            <>
              <div className="mcard__caption mcard__caption--gap">Running now</div>
              <Person
                id={runner.id}
                fullName={runner.fullName}
                nickname={runner.nickname}
                photoVersion={runner.photoVersion}
                size={28}
              />
            </>
          )}
        </div>
      </div>

      {status === 'running' && cur && (
        <div className="mcard__detail mcard__detail--running">
          <div className="mcard__op">{cur.operationName}</div>
          <div className="mcard__detail-row">
            {cur.jobNumber && <IdChip>{cur.jobNumber}</IdChip>}
            {cur.scheduledEnd && (
              <span className="mcard__finish">Finish {whenLabel(cur.scheduledEnd)}</span>
            )}
          </div>
        </div>
      )}
      {status === 'breakdown' && (
        <div className="mcard__detail mcard__detail--down">
          <div className="mcard__reason">{down?.reason || 'Reported down'}</div>
          {down?.startedAt && (
            <div className="mcard__down-for">Down {formatOpenDuration(down.startedAt, nowMs)}</div>
          )}
        </div>
      )}
      {status === 'retired' && (
        <div className="mcard__detail mcard__detail--retired">Removed from the shop floor</div>
      )}

      <footer className="mcard__stats">
        <div className="mcard__stat">
          <span className="mcard__stat-label">Jobs today</span>
          <span className="mcard__stat-value ui-tabular">{unit.jobsToday ?? 0}</span>
        </div>
        <div className="mcard__stat">
          <span className="mcard__stat-label">Next job</span>
          <span className="mcard__stat-value">
            {unit.nextOperation?.scheduledStart ? whenLabel(unit.nextOperation.scheduledStart) : '—'}
          </span>
        </div>
      </footer>
    </article>
  );
}
