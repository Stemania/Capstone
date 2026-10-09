/** "PJ · Anthony Pajantoy" when there is a nickname, else the full name. */
export function personLabel(fullName?: string | null, nickname?: string | null): string {
  const name = (fullName || '').trim();
  const nick = (nickname || '').trim();
  if (!nick || nick.toLowerCase() === name.toLowerCase()) return name;
  return name ? `${nick} · ${name}` : nick;
}

/** Up to two initials from the full name (first and last word). */
export function initials(fullName?: string | null): string {
  const words = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}
