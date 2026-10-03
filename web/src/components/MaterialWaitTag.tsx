import { Tooltip } from 'antd';
import StatusPill from './StatusPill';
import type { MaterialWait } from '../types';

export const MATERIAL_WAIT_LABEL = 'Waiting for materials';

export default function MaterialWaitTag({
  wait,
  compact = true,
}: {
  wait: MaterialWait | null | undefined;
  compact?: boolean;
}) {
  if (!wait?.waitingForMaterials) return null;
  return (
    <Tooltip title={wait.materialWaitReason || undefined}>
      <span style={{ display: 'inline-block' }}>
        <StatusPill color="amber" compact={compact}>
          {MATERIAL_WAIT_LABEL}
        </StatusPill>
      </span>
    </Tooltip>
  );
}
