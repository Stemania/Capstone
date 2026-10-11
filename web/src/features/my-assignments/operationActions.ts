import { Modal, message } from 'antd';
import { getErrorCode, getErrorMessage } from '../../api/client';
import type { Operation } from '../../types';

export function isMyOperation(op: Operation, userId: string | null | undefined): boolean {
  return Boolean(
    userId && (op.assignedWorkerId === userId || (op.helperIds || []).includes(userId))
  );
}

/** The worker's own operation, not started yet, with every earlier operation in the job done. */
export function canStartOperation(
  op: Operation,
  jobOperations: Operation[],
  userId: string | null | undefined
): boolean {
  if (!isMyOperation(op, userId)) return false;
  if (op.status !== 'PENDING' && op.status !== 'SCHEDULED' && op.status !== 'REWORK') return false;
  const index = jobOperations.findIndex((o) => o.id === op.id);
  const earlier = index < 0 ? [] : jobOperations.slice(0, index);
  return earlier.every((o) => o.status === 'COMPLETED');
}

export function operationActionLabel(op: Operation, verb: string, jobNumber?: string | null) {
  return `${verb} ${op.operationName || op.name || 'operation'}` + (jobNumber ? ` (${jobNumber})` : '');
}

export function announceRecorded(outcome: 'sent' | 'queued', online: boolean, sentText: string) {
  if (outcome === 'sent') message.success(sentText);
  else
    message.info(
      online
        ? 'Saved on this phone. It is sent right after the earlier waiting actions.'
        : 'Saved on this phone. It is sent when the connection returns.'
    );
}

/** Start/resume/complete refusals: missing materials get a dialog, anything else a toast. */
export function showActionError(err: unknown) {
  const code = getErrorCode(err);
  if (code === 'MATERIALS_NOT_RECEIVED' || code === 'MATERIALS_NOT_ORDERED') {
    Modal.warning({
      title:
        code === 'MATERIALS_NOT_ORDERED' ? 'Materials have not been ordered' : 'Materials have not arrived',
      content: getErrorMessage(err),
      okText: 'OK',
    });
  } else {
    message.error(getErrorMessage(err));
  }
}
