/** True once a catalog material is locked on the line (no free typing). */
export function materialLineLocked(catalogId: string | null | undefined): boolean {
  return Boolean(catalogId);
}

/** Size the way the shop writes it on a PO: diameter and length, " for inches. */
export const SIZE_PLACEHOLDER = 'Size, e.g. 320mm dia x 170mmL';

/** Detail display: name — size. Lines saved before grades were dropped keep their grade. */
export function formatPoMaterialLabel(
  name: string,
  gradeOrSpec?: string | null,
  sizeSpec?: string | null
): string {
  // A part repeated by older lines (grade = size, e.g. "3 mm — 3 mm") prints once.
  const parts: string[] = [];
  for (const raw of [name, gradeOrSpec, sizeSpec]) {
    const p = (raw || '').trim();
    if (p && !parts.some((q) => q.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return parts.join(' — ');
}
