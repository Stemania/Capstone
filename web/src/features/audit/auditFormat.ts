import dayjs from 'dayjs';
import type { Tone } from '../../theme/tokens';
import type { AuditEntry } from '../../types';
import { formatShop } from '../../utils/shopTime';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}(:\d{2})?$/;
const ENUM = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{3,}$/;

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  OFFICE_STAFF: 'Office Staff',
  PRODUCTION_WORKER: 'Production Worker',
};

export function roleLabel(role: string | null | undefined): string {
  return role ? ROLE_LABEL[role] || role : '';
}

/** One value from the log as a person would write it. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-PH');
  if (typeof value === 'string') {
    if (value === '[hidden]') return '(hidden)';
    if (ISO_DATETIME.test(value)) return formatShop(value, 'MMM D, YYYY h:mm A');
    if (ISO_DATE.test(value)) return dayjs(value).format('MMM D, YYYY');
    if (CLOCK.test(value)) return dayjs(`2000-01-01T${value}`).format('h:mm A');
    if (ENUM.test(value)) {
      const words = value.toLowerCase().replace(/_/g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => formatAuditValue(v)).join(', ') || '(empty)';
  return JSON.stringify(value);
}

const RED = new Set(['LOGIN_FAILED', 'LOGIN_BLOCKED', 'PIN_FAILED', 'DELETE', 'DEVICE_REVOKED']);
const GREEN = new Set(['CREATE', 'LOGIN_SUCCEEDED', 'INVITATION_USED', 'PASSWORD_SET']);
const SLATE = new Set(['LOGOUT']);

export function actionTone(action: string): Tone {
  if (RED.has(action)) return 'red';
  if (GREEN.has(action)) return 'green';
  if (SLATE.has(action)) return 'slate';
  if (action === 'UPDATE') return 'amber';
  return 'blue';
}

/** One line per change, for the CSV export. */
export function detailsText(entry: AuditEntry): string {
  return entry.details
    .map((d) =>
      'value' in d && d.value !== undefined
        ? `${d.label}: ${formatAuditValue(d.value)}`
        : `${d.label}: ${formatAuditValue(d.from)} → ${formatAuditValue(d.to)}`,
    )
    .join('; ');
}
