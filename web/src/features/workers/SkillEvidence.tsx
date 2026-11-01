import { Button, Tooltip } from 'antd';
import { ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { SkillEvidenceRow } from '../../types';
import { formatShop } from '../../utils/shopTime';

/** What each level means, so every Administrator rates the same way. */
export const LEVEL_GUIDE: { level: number; name: string; meaning: string }[] = [
  { level: 1, name: 'Trainee', meaning: 'Works on this machine only as a helper.' },
  { level: 2, name: 'Assisted', meaning: 'Runs simple jobs; someone checks the setup.' },
  { level: 3, name: 'Independent', meaning: 'Sets up and runs standard work alone, within tolerance.' },
  { level: 4, name: 'Advanced', meaning: 'Handles tight tolerances and complex setups; fixes problems himself.' },
  { level: 5, name: 'Expert', meaning: 'Takes the hardest jobs and can train others.' },
];

export function levelName(level: number | null | undefined): string {
  return LEVEL_GUIDE.find((l) => l.level === level)?.name || '';
}

export function LevelGuide() {
  return (
    <div className="ws-guide">
      {LEVEL_GUIDE.map((l) => (
        <div key={l.level} className="ws-guide__row">
          <strong>
            {l.level} · {l.name}
          </strong>
          <span>{l.meaning}</span>
        </div>
      ))}
      <div className="ws-guide__note">
        The record and the suggested level come from the last 12 months of finished operations. They
        are a guide; you decide the level.
      </div>
    </div>
  );
}

function pct(v: number | null) {
  return v == null ? '—' : `${Math.round(v)}%`;
}

/** Last 12 months on this machine, in two short lines. */
export function SkillRecord({ ev }: { ev?: SkillEvidenceRow }) {
  if (!ev || (!ev.leadOps && !ev.helperOps)) {
    return <span className="ui-muted-note">No operations in 12 months</span>;
  }
  const last = ev.lastDoneAt ? formatShop(ev.lastDoneAt, 'MMM D, YYYY') : null;
  return (
    <div className="ws-record">
      <div>
        {ev.leadOps} as lead · {ev.helperOps} helped{last ? ` · last ${last}` : ''}
      </div>
      {ev.leadOps ? (
        <div className="ws-record__sub">
          <Tooltip title="How long his operations took compared with how long his peers usually take for the same operation types. 100% is the same pace; above is faster.">
            <span className="ws-record__k">{pct(ev.speedVsPeersPct)} of peers&apos; speed</span>
          </Tooltip>
          {' · '}
          <Tooltip title="Finished within 10% of the target hours, or faster.">
            <span className="ws-record__k">{pct(ev.onTargetPct)} on target</span>
          </Tooltip>
          {' · '}
          <Tooltip title="Sent back for operator error, out-of-tolerance dimensions, or surface finish. Machine faults and wrong material are not counted.">
            <span className={`ws-record__k${ev.operatorRedoPct && ev.operatorRedoPct > 10 ? ' is-bad' : ''}`}>
              {ev.operatorRedos} redo{ev.operatorRedos === 1 ? '' : 's'}
              {ev.operatorRedos ? ` (${pct(ev.operatorRedoPct)})` : ''}
            </span>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

/** The suggested level with its reason, a Use button, and any warnings. */
export function SkillSuggestion({
  ev,
  current,
  enabled,
  onUse,
}: {
  ev?: SkillEvidenceRow;
  current: number;
  enabled: boolean;
  onUse: (level: number) => void;
}) {
  const flags: string[] = [];
  if (ev?.suggestedLevel != null && enabled && Math.abs(ev.suggestedLevel - current) >= 2) {
    flags.push(
      `Rated ${current}, but the record suggests ${ev.suggestedLevel}. Consider a ${
        ev.suggestedLevel > current ? 'higher' : 'lower'
      } level.`
    );
  }
  for (const f of ev?.flags || []) {
    if (f.kind === 'unused' && enabled) flags.push(f.text);
  }

  if (ev?.suggestedLevel == null) {
    return (
      <span className="ws-suggest ws-suggest--none">
        <span className="ui-muted-note">—</span>
        {ev?.suggestionReason ? (
          <Tooltip title={ev.suggestionReason}>
            <InfoCircleOutlined className="ws-suggest__info" aria-label={ev.suggestionReason} />
          </Tooltip>
        ) : null}
        {flags.length ? <FlagIcon flags={flags} /> : null}
      </span>
    );
  }
  const same = enabled && ev.suggestedLevel === current;
  return (
    <span className="ws-suggest">
      <Tooltip title={ev.suggestionReason}>
        <span className="ws-suggest__level">
          {ev.suggestedLevel} · {levelName(ev.suggestedLevel)}
        </span>
      </Tooltip>
      {enabled && !same ? (
        <Button size="small" type="link" className="ws-suggest__use" onClick={() => onUse(ev.suggestedLevel!)}>
          Use
        </Button>
      ) : null}
      {flags.length ? <FlagIcon flags={flags} /> : null}
    </span>
  );
}

function FlagIcon({ flags }: { flags: string[] }) {
  return (
    <Tooltip
      title={
        <div>
          {flags.map((f) => (
            <div key={f}>{f}</div>
          ))}
        </div>
      }
    >
      <ExclamationCircleOutlined className="ws-suggest__flag" aria-label={flags.join(' ')} />
    </Tooltip>
  );
}
