/** True once a catalog material is locked on the line (no free typing). */
export function materialLineLocked(catalogId: string | null | undefined): boolean {
  return Boolean(catalogId);
}

/** Printed / detail display: name — grade — size/spec. */
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
