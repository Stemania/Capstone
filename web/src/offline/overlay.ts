/** Show actions still on the phone as if the server had accepted them. */

import type { Operation, OperationTimeLog } from '../types';
import type { QueuedAction, QueuedActionError } from './actionQueue';

export type OverlaidOperation = Operation & {
  /** Waiting to send, or refused by the server and waiting for the worker. */
  syncState?: 'waiting' | 'refused';
  syncError?: QueuedActionError;
};

function log(op: Operation, a: QueuedAction, event: OperationTimeLog['event']): OperationTimeLog {
  return {
    id: `pending-${a.id}`,
    operationId: op.id,
    workerId: a.userId,
    event,
    eventAt: a.at,
    reason: event === 'PAUSE' ? (a.kind === 'breakdown' ? 'MACHINE_DOWN' : a.reason) : null,
  };
}

function apply(op: OverlaidOperation, a: QueuedAction): OverlaidOperation {
  const logs = op.timeLogs || [];
  switch (a.kind) {
    case 'start':
      return {
        ...op,
        status: 'IN_PROGRESS',
        isPaused: false,
        actualStart: op.actualStart || a.at,
        timeLogs: [...logs, log(op, a, 'START')],
      };
    case 'pause':
      return { ...op, isPaused: true, timeLogs: [...logs, log(op, a, 'PAUSE')] };
    case 'resume':
      return { ...op, isPaused: false, timeLogs: [...logs, log(op, a, 'RESUME')] };
    case 'complete':
      return {
        ...op,
        status: 'COMPLETED',
        isPaused: false,
        actualEnd: a.at,
        timeLogs: [...logs, log(op, a, 'COMPLETE')],
      };
    case 'breakdown': {
      const running = op.status === 'IN_PROGRESS' && !op.isPaused;
      return {
        ...op,
        machineDown: true,
        ...(running ? { isPaused: true, timeLogs: [...logs, log(op, a, 'PAUSE')] } : {}),
      };
    }
  }
}

export function overlayOperations<T extends Operation>(
  ops: T[],
  actions: QueuedAction[]
): (T & OverlaidOperation)[] {
  return ops.map((op) => {
    let out: T & OverlaidOperation = { ...op };
    for (const a of actions) {
      const hits =
        a.operationId === op.id ||
        (a.kind === 'breakdown' && !!a.machineUnitId && a.machineUnitId === op.machineUnitId);
      if (!hits) continue;
      out = apply(out, a) as T & OverlaidOperation;
      if (a.operationId === op.id) {
        if (a.state === 'refused') {
          out.syncState = 'refused';
          out.syncError = a.error;
        } else if (out.syncState !== 'refused') {
          out.syncState = 'waiting';
        }
      }
    }
    return out;
  });
}
