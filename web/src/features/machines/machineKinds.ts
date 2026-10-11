import type { CSSProperties } from 'react';
import bendingArt from '../../assets/machines/bending.svg';
import drillingArt from '../../assets/machines/drilling.svg';
import grindingArt from '../../assets/machines/grinding.svg';
import laserArt from '../../assets/machines/laser.svg';
import latheArt from '../../assets/machines/lathe.svg';
import millingArt from '../../assets/machines/milling.svg';
import otherArt from '../../assets/machines/other.svg';
import shaperArt from '../../assets/machines/shaper.svg';

export type MachineKind =
  | 'bending'
  | 'drilling'
  | 'grinding'
  | 'laser'
  | 'lathe'
  | 'milling'
  | 'shaper'
  | 'other';

/**
 * One accent per machine type, used on its section and cards. Hues stay clear
 * of the status colours (green running, red breakdown, slate idle).
 */
type Accent = { fg: string; solid: string; bg: string; border: string; wash: string };

const KINDS: Record<MachineKind, { art: string; accent: Accent }> = {
  bending: {
    art: bendingArt,
    accent: { fg: '#86198f', solid: '#a21caf', bg: '#fbf0fc', border: '#efd3f2', wash: '#fdf8fd' },
  },
  drilling: {
    art: drillingArt,
    accent: { fg: '#4338ca', solid: '#6366f1', bg: '#eef0ff', border: '#d6d9fb', wash: '#f8f8ff' },
  },
  grinding: {
    art: grindingArt,
    accent: { fg: '#92400e', solid: '#d97706', bg: '#fdf5e6', border: '#f1dfb8', wash: '#fefbf4' },
  },
  laser: {
    art: laserArt,
    accent: { fg: '#0e7490', solid: '#0891b2', bg: '#e9f7fa', border: '#c3e7ef', wash: '#f6fbfc' },
  },
  lathe: {
    art: latheArt,
    accent: { fg: '#8a4b1c', solid: '#b0612a', bg: '#f9f1ea', border: '#ecd8c6', wash: '#fcf9f6' },
  },
  milling: {
    art: millingArt,
    accent: { fg: '#1d4ed8', solid: '#2563eb', bg: '#edf3ff', border: '#cfdcfb', wash: '#f7f9ff' },
  },
  shaper: {
    art: shaperArt,
    accent: { fg: '#6d28d9', solid: '#7c3aed', bg: '#f4f0fe', border: '#ddd2fa', wash: '#faf8ff' },
  },
  other: {
    art: otherArt,
    accent: { fg: '#334155', solid: '#64748b', bg: '#eef2f7', border: '#d5dce6', wash: '#f8fafc' },
  },
};

/** Code first ("LATHE"), then the name, so old and new names both match. */
export function machineKind(name?: string | null, code?: string | null): MachineKind {
  const s = `${code || ''} ${name || ''}`.toLowerCase();
  if (s.includes('lathe') || s.includes('turn')) return 'lathe';
  if (s.includes('mill')) return 'milling';
  if (s.includes('drill')) return 'drilling';
  if (s.includes('grind')) return 'grinding';
  if (s.includes('bend') || s.includes('press brake')) return 'bending';
  if (s.includes('laser')) return 'laser';
  if (s.includes('shap')) return 'shaper';
  return 'other';
}

export function machineArt(kind: MachineKind): string {
  return KINDS[kind].art;
}

/** CSS variables for a type's accent, set on its section, chip or drawer. */
export function accentVars(kind: MachineKind): CSSProperties {
  const a = KINDS[kind].accent;
  return {
    '--mt-fg': a.fg,
    '--mt-solid': a.solid,
    '--mt-bg': a.bg,
    '--mt-border': a.border,
    '--mt-wash': a.wash,
  } as CSSProperties;
}
