/** This browser's device id and a short readable name for it. */

const DEVICE_KEY = 'bmsc_device_id';

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function readDeviceId(): string | null {
  return localStorage.getItem(DEVICE_KEY);
}

export type DeviceKind = 'phone' | 'tablet' | 'desktop';

export type DeviceInfo = { name: string; kind: DeviceKind };

function kindOf(name: string): DeviceKind {
  if (/iPad|tablet/i.test(name)) return 'tablet';
  if (/iPhone|iPod|phone|Android|Mobile/i.test(name)) return 'phone';
  return 'desktop';
}

/**
 * "Android phone · Chrome 141" from a user agent. Labels already stored in
 * that short form pass through; older rows hold a user agent cut to 120
 * characters, which can lose the Edge marker.
 */
export function describeDevice(label: string | null | undefined, deviceId = ''): DeviceInfo {
  const raw = (label || '').trim();
  if (!raw) return { name: `Device ${deviceId.slice(0, 8)}`, kind: 'desktop' };
  if (!raw.includes('Mozilla')) return { name: raw.slice(0, 60), kind: kindOf(raw) };

  let os = 'Device';
  let kind: DeviceKind = 'desktop';
  if (/iPhone|iPod/.test(raw)) {
    os = 'iPhone';
    kind = 'phone';
  } else if (/iPad/.test(raw)) {
    os = 'iPad';
    kind = 'tablet';
  } else if (/Android/.test(raw)) {
    kind = /Mobile/.test(raw) ? 'phone' : 'tablet';
    os = kind === 'phone' ? 'Android phone' : 'Android tablet';
  } else if (/Windows/.test(raw)) os = 'Windows';
  else if (/CrOS/.test(raw)) os = 'Chromebook';
  else if (/Mac OS X|Macintosh/.test(raw)) os = 'Mac';
  else if (/Linux/.test(raw)) os = 'Linux';

  const version = (token: string) => raw.match(new RegExp(`${token}/(\\d+)`))?.[1] ?? '';
  let browser = '';
  if (/Edg(A|iOS)?\//.test(raw)) browser = `Edge ${version('Edg(?:A|iOS)?')}`;
  else if (/Cursor\//.test(raw)) browser = 'Cursor browser';
  else if (/SamsungBrowser\//.test(raw)) browser = `Samsung Internet ${version('SamsungBrowser')}`;
  else if (/CriOS\//.test(raw)) browser = `Chrome ${version('CriOS')}`;
  else if (/FxiOS\//.test(raw)) browser = `Firefox ${version('FxiOS')}`;
  else if (/Firefox\//.test(raw)) browser = `Firefox ${version('Firefox')}`;
  else if (/Chrome\//.test(raw)) browser = `Chrome ${version('Chrome')}`;
  else if (/Safari\//.test(raw)) browser = `Safari ${version('Version')}`;

  return { name: browser ? `${os} · ${browser.trim()}` : os, kind };
}

export function thisDeviceLabel(): string {
  return describeDevice(navigator.userAgent).name;
}
