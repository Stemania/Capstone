import type { ReactNode } from 'react';

export type PillColor = 'blue' | 'green' | 'amber' | 'red' | 'gray';

const styles: Record<PillColor, { color: string; bg: string }> = {
  blue: { color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  green: { color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  amber: { color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  red: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  gray: { color: '#64748b', bg: '#f1f5f9' },
};

export default function StatusPill({ color, children }: { color: PillColor; children: ReactNode }) {
  const s = styles[color];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 999,
        background: s.bg,
        color: s.color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
