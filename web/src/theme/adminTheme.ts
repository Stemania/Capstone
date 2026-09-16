import type { ThemeConfig } from 'antd';

/** Admin/office UI scale (~90% of Ant Design defaults). Not applied to worker shell. */
export const ADMIN_UI_SCALE = 0.9;

export function adminPx(px: number): number {
  return Math.round(px * ADMIN_UI_SCALE);
}

/** Ant Design seed defaults (for worker reset and before/after reporting). */
export const ANT_DEFAULT_SEED = {
  fontSize: 14,
  controlHeight: 32,
  controlHeightSM: 24,
  controlHeightLG: 40,
  sizeUnit: 4,
  sizeStep: 4,
} as const;

/**
 * Seed tokens at ~90% so Ant Design tables, controls, and spacing densify
 * without CSS zoom (breakpoints stay in real CSS pixels).
 */
export const ADMIN_SEED_TOKENS = {
  fontSize: ANT_DEFAULT_SEED.fontSize * ADMIN_UI_SCALE, // 12.6
  controlHeight: ANT_DEFAULT_SEED.controlHeight * ADMIN_UI_SCALE, // 28.8
  controlHeightSM: ANT_DEFAULT_SEED.controlHeightSM * ADMIN_UI_SCALE, // 21.6
  controlHeightLG: ANT_DEFAULT_SEED.controlHeightLG * ADMIN_UI_SCALE, // 36
  sizeUnit: ANT_DEFAULT_SEED.sizeUnit * ADMIN_UI_SCALE, // 3.6
  sizeStep: ANT_DEFAULT_SEED.sizeStep, // keep step; sizeUnit carries the 10% cut
} as const;

/** Full-size seeds so WorkerLayout does not inherit the admin density. */
export const WORKER_SEED_TOKENS = {
  fontSize: ANT_DEFAULT_SEED.fontSize,
  controlHeight: ANT_DEFAULT_SEED.controlHeight,
  controlHeightSM: ANT_DEFAULT_SEED.controlHeightSM,
  controlHeightLG: ANT_DEFAULT_SEED.controlHeightLG,
  sizeUnit: ANT_DEFAULT_SEED.sizeUnit,
  sizeStep: ANT_DEFAULT_SEED.sizeStep,
} as const;

export const adminThemeComponents: ThemeConfig['components'] = {
  Table: {
    headerBg: '#f8fafc',
    headerColor: '#475569',
    // Default MD cell padding is ~8 / 16; trim ~10% with the denser seed spacing.
    cellPaddingBlock: 7,
    cellPaddingInline: 14,
  },
  Menu: {
    // Default itemHeight is 40.
    itemHeight: adminPx(40),
  },
};
