import { stepSignature } from '../shared/step';
import type { FrameSnapshot, StepSchema } from '../shared/types';

export interface CapturedFrame {
  frameId: number;
  snapshot: FrameSnapshot;
}

/**
 * Joins what every readable frame reported into one step. The top frame names the step;
 * embedded frames the extension could not read are listed as blocked.
 */
export function mergeSnapshots(frames: readonly CapturedFrame[]): StepSchema {
  const ordered = [...frames].sort((a, b) => a.frameId - b.frameId);
  const top = ordered[0]?.snapshot;
  const fields = ordered.flatMap((frame) => frame.snapshot.fields);
  const readable = new Set(ordered.map((frame) => frame.snapshot.origin));
  const embedded = new Set(ordered.flatMap((frame) => frame.snapshot.iframeOrigins));

  return {
    // Labels only: the same step of another job on the same portal has the same signature.
    signature: stepSignature(fields),
    url: top?.url ?? '',
    ...(top?.title ? { title: top.title } : {}),
    fields,
    buttons: ordered.flatMap((frame) => frame.snapshot.buttons),
    repeatables: ordered.flatMap((frame) => frame.snapshot.repeatables),
    blockedOrigins: [...embedded].filter((origin) => !readable.has(origin)).sort(),
  };
}
