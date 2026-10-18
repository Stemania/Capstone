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
  return [name, gradeOrSpec, sizeSpec].map((p) => (p || '').trim()).filter(Boolean).join(' — ');
}
