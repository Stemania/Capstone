/** Schedule board geometry stays at its dense ~90% grid so a week fits on one screen. */
export const ADMIN_UI_SCALE = 0.9;

export function adminPx(px: number): number {
  return Math.round(px * ADMIN_UI_SCALE);
}
