import { describe, expect, it } from 'vitest';
import { colors, tones } from './tokens';

function luminance(hex: string) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour contrast (WCAG AA, 4.5:1 for small text)', () => {
  it.each(Object.entries(tones))('%s pill text on its background', (_name, t) => {
    expect(ratio(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['text on surface', colors.text, colors.surface],
    ['secondary text on surface', colors.textSecondary, colors.surface],
    ['muted text on surface', colors.textMuted, colors.surface],
    ['muted text on page', colors.textMuted, colors.page],
    ['sidebar text on navy', colors.sidebarText, colors.navy],
    ['white on primary', colors.textOnColor, colors.primary],
  ])('%s', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
