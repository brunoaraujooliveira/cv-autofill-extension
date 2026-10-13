import type { RunPhase } from './types';

export type RunEvent =
  | 'START'
  | 'FIELDS_FOUND'
  | 'NOTHING_TO_FILL'
  | 'MAPPED'
  | 'FILLED'
  | 'NEEDS_ANOTHER_ROUND'
  | 'STEP_READY'
  | 'FINAL_STEP'
  | 'CONFIRM'
  | 'STEP_CHANGED'
  | 'RECHECK'
  | 'STUCK'
  | 'FINISH'
  | 'CANCEL'
  | 'FAIL';

/**
 * Every move the run is allowed to make. Submitting is not an event: the only way forward
 * from a step is CONFIRM, and a step whose way forward is a submit button ends in FINAL_REVIEW.
 */
const TRANSITIONS: Record<RunPhase, Partial<Record<RunEvent, RunPhase>>> = {
  IDLE: { START: 'EXTRACTING' },
  EXTRACTING: {
    FIELDS_FOUND: 'MAPPING',
    NOTHING_TO_FILL: 'WAITING_USER_REVIEW',
    FINAL_STEP: 'FINAL_REVIEW',
    CANCEL: 'WAITING_USER_REVIEW',
    FAIL: 'ERROR',
  },
  MAPPING: { MAPPED: 'FILLING', CANCEL: 'WAITING_USER_REVIEW', FAIL: 'ERROR' },
  FILLING: { FILLED: 'VALIDATING', CANCEL: 'WAITING_USER_REVIEW', FAIL: 'ERROR' },
  VALIDATING: {
    NEEDS_ANOTHER_ROUND: 'MAPPING',
    STEP_READY: 'WAITING_USER_REVIEW',
    FINAL_STEP: 'FINAL_REVIEW',
    CANCEL: 'WAITING_USER_REVIEW',
    FAIL: 'ERROR',
  },
  WAITING_USER_REVIEW: { CONFIRM: 'ADVANCING', START: 'EXTRACTING', FINAL_STEP: 'FINAL_REVIEW' },
  ADVANCING: {
    STEP_CHANGED: 'EXTRACTING',
    RECHECK: 'EXTRACTING',
    STUCK: 'WAITING_USER_REVIEW',
    FINAL_STEP: 'FINAL_REVIEW',
    CANCEL: 'WAITING_USER_REVIEW',
    FAIL: 'ERROR',
  },
  FINAL_REVIEW: { FINISH: 'DONE', START: 'EXTRACTING' },
  DONE: { START: 'EXTRACTING' },
  ERROR: { START: 'EXTRACTING' },
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly phase: RunPhase,
    readonly event: RunEvent,
  ) {
    super(`Event ${event} is not allowed in phase ${phase}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(phase: RunPhase, event: RunEvent): boolean {
  return TRANSITIONS[phase][event] !== undefined;
}

export function transition(phase: RunPhase, event: RunEvent): RunPhase {
  const next = TRANSITIONS[phase][event];
  if (!next) throw new InvalidTransitionError(phase, event);
  return next;
}

/** Phases in which the extension is working and the user should wait. */
export const BUSY_PHASES: ReadonlySet<RunPhase> = new Set([
  'EXTRACTING',
  'MAPPING',
  'FILLING',
  'VALIDATING',
  'ADVANCING',
]);
