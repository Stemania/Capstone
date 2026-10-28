import { describe, expect, it } from 'vitest';
import { actionTone, detailsText, formatAuditValue, roleLabel } from './auditFormat';
import type { AuditEntry } from '../../types';

describe('formatAuditValue', () => {
  it('writes values the way a person would', () => {
    expect(formatAuditValue(null)).toBe('(empty)');
    expect(formatAuditValue(true)).toBe('Yes');
    expect(formatAuditValue('[hidden]')).toBe('(hidden)');
    expect(formatAuditValue('2031-04-08')).toBe('Apr 8, 2031');
    expect(formatAuditValue('2031-04-08T01:00:00+00:00')).toBe('Apr 8, 2031 9:00 AM');
    expect(formatAuditValue('13:30:00')).toBe('1:30 PM');
    expect(formatAuditValue('IN_PROGRESS')).toBe('In progress');
    expect(formatAuditValue('DRAFT')).toBe('Draft');
    expect(formatAuditValue('Lathe A-1')).toBe('Lathe A-1');
    expect(formatAuditValue(1500)).toBe('1,500');
  });
});

describe('labels', () => {
  it('names roles and colours risky actions red', () => {
    expect(roleLabel('OFFICE_STAFF')).toBe('Office Staff');
    expect(actionTone('LOGIN_FAILED')).toBe('red');
    expect(actionTone('UPDATE')).toBe('amber');
    expect(actionTone('LOGIN_SUCCEEDED')).toBe('green');
  });

  it('flattens details for the CSV', () => {
    const entry = {
      details: [
        { label: 'Due date', from: '2031-04-01', to: '2031-04-08' },
        { label: 'Reason', value: 'Wrong password' },
      ],
    } as AuditEntry;
    expect(detailsText(entry)).toBe('Due date: Apr 1, 2031 → Apr 8, 2031; Reason: Wrong password');
  });
});
