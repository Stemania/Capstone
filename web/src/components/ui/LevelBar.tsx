/** Skill level 1–5 as a five-segment bar plus the number. */
export default function LevelBar({ level, max = 5 }: { level: number; max?: number }) {
  const n = Math.max(0, Math.min(max, Math.round(level)));
  return (
    <span className="ui-level" role="img" aria-label={`Level ${n} of ${max}`}>
      <span className="ui-level__bar">
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} className={`ui-level__seg${i < n ? ' is-on' : ''}`} />
        ))}
      </span>
      <span className="ui-level__num">{n}</span>
    </span>
  );
}
