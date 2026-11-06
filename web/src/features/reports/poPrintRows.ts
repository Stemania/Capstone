import type { SupplierOrderPrint } from '../../types';

type Line = SupplierOrderPrint['rows'][number];

/** One printed table row: a material heading, or a line with its numbers. */
export type PoPrintRow =
  | { kind: 'heading'; key: string; text: string }
  | { kind: 'line'; key: string; text: string; line: Line };

const clean = (v?: string | null) => (v || '').trim();

/**
 * Rows in the shop's PO layout: the material name once, then each size below
 * it ("1045" / "320mm dia x 170mmL" / "160mm dia x 40\""). A material with a
 * single line and no size prints on one row. A grade saved on an older line
 * stays with its material name.
 */
export function poPrintRows(lines: Line[]): PoPrintRow[] {
  const groups: { name: string; lines: Line[] }[] = [];
  for (const line of lines) {
    const name = [clean(line.materialName), clean(line.gradeOrSpec)].filter(Boolean).join(' ');
    const key = `${line.isConsumable ? 'c' : 'm'}:${name.toLowerCase()}`;
    const group = groups.find((g) => `${g.lines[0].isConsumable ? 'c' : 'm'}:${g.name.toLowerCase()}` === key);
    if (group) group.lines.push(line);
    else groups.push({ name, lines: [line] });
  }

  const rows: PoPrintRow[] = [];
  groups.forEach((g, gi) => {
    const sized = g.lines.filter((l) => clean(l.sizeSpec));
    if (!sized.length && g.lines.length === 1) {
      rows.push({ kind: 'line', key: `${gi}-0`, text: g.name, line: g.lines[0] });
      return;
    }
    rows.push({ kind: 'heading', key: `${gi}-h`, text: g.name });
    g.lines.forEach((l, li) => {
      rows.push({ kind: 'line', key: `${gi}-${li}`, text: clean(l.sizeSpec) || g.name, line: l });
    });
  });
  return rows;
}
