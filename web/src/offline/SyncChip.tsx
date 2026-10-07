import type { OverlaidOperation } from './overlay';

export default function SyncChip({ state }: { state: NonNullable<OverlaidOperation['syncState']> }) {
  const refused = state === 'refused';
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        background: refused ? 'rgba(122,21,40,0.12)' : 'rgba(100,116,139,0.16)',
        color: refused ? '#7A1528' : '#475569',
      }}
    >
      {refused ? 'Not accepted' : 'Waiting to send'}
    </span>
  );
}
