import { LockOutlined, RightOutlined, StarFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { useOffline } from '../../offline/OfflineProvider';
import { PersonAvatar } from '../../components/PersonAvatar';
import { LevelBar, PageSkeleton } from '../../components/ui';
import { useMyProfile } from './useMyProfile';
import { formatRange } from './workerFormat';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Read-only: skills, assigned machine and hours are set by the Admin. */
export default function WorkerProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { online } = useOffline();
  const { me, loading, skills } = useMyProfile(online);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/home'));

  if (!me) {
    return (
      <div>
        <WorkerPageHeader title="My profile" onBack={back} />
        {loading ? (
          <PageSkeleton variant="detail" />
        ) : (
          <div className="w-page">
            <div className="w-card w-note">
              {online ? 'Could not load your profile. Try again in a moment.' : 'Connect to see your profile.'}
            </div>
          </div>
        )}
      </div>
    );
  }

  const byDay = new Map((me.schedules || []).map((s) => [s.dayOfWeek, s]));
  const machines = me.assignedMachines || [];

  return (
    <div>
      <WorkerPageHeader title="My profile" onBack={back} />
      <div className="w-page">
        <section className="w-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PersonAvatar userId={me.id} fullName={me.fullName} photoVersion={me.photoVersion} size={52} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, overflowWrap: 'anywhere' }}>{me.fullName}</div>
            <div className="w-note">
              Production worker
              {me.email ? ` · ${me.email}` : me.mobileNumber ? ` · ${me.mobileNumber}` : ''}
            </div>
          </div>
        </section>

        <section className="w-card w-card--flush">
          <div className="w-card__head">
            <span className="w-card__title">Skills</span>
          </div>
          {skills.length === 0 ? (
            <div className="w-dayoff">No machine skills set yet. Ask the Admin.</div>
          ) : (
            <div className="w-rows">
              {skills.map((s) => (
                <div key={s.machineTypeId} className="w-row" style={{ cursor: 'default', minHeight: 48 }}>
                  <div className="w-row__main">
                    <div className="w-row__title">
                      {s.machineTypeName || s.machineTypeCode}
                      {s.isPrimary && <StarFilled className="w-skill__primary" aria-hidden />}
                    </div>
                    {s.isPrimary && <div className="w-row__sub">Primary skill</div>}
                  </div>
                  <LevelBar level={s.proficiency} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="w-card w-card--flush">
          <div className="w-card__head">
            <span className="w-card__title">Assigned machine</span>
          </div>
          {machines.length === 0 ? (
            <div className="w-dayoff">No machine assigned to you. You may be given any machine you have a skill for.</div>
          ) : (
            <div className="w-rows">
              {machines.map((m) => (
                <div key={m.id} className="w-row" style={{ cursor: 'default', minHeight: 48 }}>
                  <div className="w-row__main">
                    <div className="w-row__title">{m.label}</div>
                    {m.machineTypeName && <div className="w-row__sub">{m.machineTypeName}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="w-card w-card--flush">
          <div className="w-card__head">
            <span className="w-card__title">Working hours</span>
          </div>
          {byDay.size === 0 ? (
            <div className="w-dayoff">You follow the shop&apos;s regular hours.</div>
          ) : (
            <div className="w-rows">
              {DAYS.map((name, dow) => {
                const s = byDay.get(dow);
                const working = s?.isWorking && s.startTime && s.endTime;
                return (
                  <div key={name} className="w-row" style={{ cursor: 'default', minHeight: 44, padding: '8px 14px' }}>
                    <div className="w-row__main" style={{ fontSize: 14 }}>
                      {name}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: working ? undefined : 'var(--c-text-muted)' }}>
                      {working ? formatRange(s.startTime, s.endTime) : 'Off'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="w-note" style={{ padding: '0 4px' }}>
          Skills, machine and hours are set by the Admin. Tell them if something is wrong.
        </div>

        {user && (
          <section className="w-card w-card--flush">
            <button type="button" className="w-row" onClick={() => navigate('/account/security')}>
              <span className="w-row__icon">
                <LockOutlined />
              </span>
              <div className="w-row__main">
                <div className="w-row__title">Account security</div>
                <div className="w-row__sub">Password, PIN and signed-in devices</div>
              </div>
              <RightOutlined className="w-row__chev" />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
