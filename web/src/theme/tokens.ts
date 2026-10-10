/**
 * Design tokens for every screen. CSS reads the same values as custom
 * properties (theme/theme.css); keep the two in sync.
 */

export const colors = {
  navy: '#0f172a',
  navyRaised: '#1e293b',
  sidebarText: '#cbd5e1',
  sidebarMuted: '#7c8aa0',
  sidebarActiveBg: 'rgba(59, 130, 246, 0.2)',
  gold: '#f1c232',
  goldSoft: '#fdf5d6',

  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primarySoft: '#eff6ff',

  page: '#f3f5f9',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceSunken: '#eef2f7',
  border: '#e3e8ef',
  borderStrong: '#cbd5e1',

  text: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#5a6a80',
  textDisabled: '#94a3b8',
  textOnColor: '#ffffff',
  overlay: 'rgba(15, 23, 42, 0.45)',
} as const;

export type Tone = 'slate' | 'blue' | 'indigo' | 'green' | 'teal' | 'amber' | 'red' | 'grey';

/** fg on bg meets WCAG AA (4.5:1) for 12px text; solid is for bars, dots and charts. */
export const tones: Record<Tone, { fg: string; bg: string; border: string; solid: string }> = {
  slate: { fg: '#334155', bg: '#eef2f7', border: '#d5dce6', solid: '#64748b' },
  blue: { fg: '#1d4ed8', bg: '#eaf1ff', border: '#c7d8fe', solid: '#2563eb' },
  indigo: { fg: '#4338ca', bg: '#eef0ff', border: '#d2d6fb', solid: '#6366f1' },
  green: { fg: '#15803d', bg: '#eafaf0', border: '#c2ecd1', solid: '#16a34a' },
  teal: { fg: '#0f766e', bg: '#e7f8f6', border: '#bfe9e3', solid: '#0d9488' },
  amber: { fg: '#a16207', bg: '#fdf6e3', border: '#f3e1a8', solid: '#f59e0b' },
  red: { fg: '#b91c1c', bg: '#fdeeee', border: '#f7caca', solid: '#dc2626' },
  grey: { fg: '#52525b', bg: '#f1f1f3', border: '#dcdce0', solid: '#a1a1aa' },
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

export const radius = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

export const font = {
  family:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Mono', 'Consolas', 'SFMono-Regular', Menlo, monospace",
  size: { xs: 12, sm: 13, base: 14, md: 15, lg: 16, title: 20, kpi: 24 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
} as const;

export const shadow = {
  card: '0 1px 2px rgba(15, 23, 42, 0.04)',
  raised: '0 2px 6px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  overlay: '0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06)',
} as const;

export const layout = {
  sidebarWidth: 232,
  sidebarCollapsedWidth: 72,
  topBarHeight: 60,
  pagePadding: 24,
  cardPadding: 16,
  controlHeight: 32,
  tableRowHeight: 44,
  workerTapTarget: 48,
} as const;

export const motion = { fast: '150ms cubic-bezier(0.2, 0, 0, 1)' } as const;

/** Same order in every chart so a series keeps its colour across pages. Each is ≥3:1 on white. */
export const chartPalette = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#6366f1',
  '#dc2626',
  '#0284c7',
  '#65a30d',
  '#64748b',
] as const;

export const chart = {
  grid: '#e8edf3',
  axis: '#64748b',
  axisFontSize: 12,
} as const;
