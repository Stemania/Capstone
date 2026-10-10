import type { ReactNode } from 'react';

type Kind = 'lathe' | 'milling' | 'drilling' | 'grinding' | 'bending' | 'laser' | 'shaper' | 'other';

function kindOf(name?: string | null, code?: string | null): Kind {
  const s = `${name || ''} ${code || ''}`.toLowerCase();
  if (s.includes('lathe') || s.includes('turn')) return 'lathe';
  if (s.includes('mill')) return 'milling';
  if (s.includes('drill')) return 'drilling';
  if (s.includes('grind')) return 'grinding';
  if (s.includes('bend') || s.includes('press brake')) return 'bending';
  if (s.includes('laser')) return 'laser';
  if (s.includes('shap')) return 'shaper';
  return 'other';
}

const PATHS: Record<Kind, ReactNode> = {
  lathe: (
    <>
      <rect x="2" y="15" width="20" height="3" rx="1" />
      <rect x="3" y="7" width="5" height="8" rx="1" />
      <path d="M8 11h9" />
      <path d="M17 9v4" />
      <path d="M19 10v2" />
      <path d="M5 18v3M19 18v3" />
    </>
  ),
  milling: (
    <>
      <path d="M6 3h8v5H6z" />
      <path d="M10 8v5" />
      <path d="M8.5 13h3l-.5 3h-2z" />
      <rect x="3" y="18" width="18" height="3" rx="1" />
      <path d="M14 5h5v13" />
    </>
  ),
  drilling: (
    <>
      <rect x="7" y="3" width="10" height="6" rx="1" />
      <path d="M12 9v3" />
      <path d="M10.5 12h3l-1.5 6z" />
      <path d="M4 21h16" />
    </>
  ),
  grinding: (
    <>
      <circle cx="12" cy="10" r="6" />
      <circle cx="12" cy="10" r="1.5" />
      <path d="M8 19h8M12 16v3" />
      <path d="M19 6l2-2M19 10h2" />
    </>
  ),
  bending: (
    <>
      <path d="M3 18h9l7-9" />
      <path d="M9 3v6l3 3 3-3V3" />
      <path d="M3 21h18" />
    </>
  ),
  laser: (
    <>
      <rect x="8" y="3" width="8" height="6" rx="1" />
      <path d="M12 9v8" strokeDasharray="2 2" />
      <path d="M3 19h18" />
      <path d="M9 17l3 2 3-2" />
    </>
  ),
  shaper: (
    <>
      <rect x="3" y="5" width="14" height="4" rx="1" />
      <path d="M17 7h4" />
      <path d="M6 9v4h3" />
      <rect x="4" y="16" width="16" height="3" rx="1" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </>
  ),
};

/** Line icon for a machine type, chosen from its name/code. */
export default function MachineTypeIcon({
  name,
  code,
  size = 20,
}: {
  name?: string | null;
  code?: string | null;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[kindOf(name, code)]}
    </svg>
  );
}
