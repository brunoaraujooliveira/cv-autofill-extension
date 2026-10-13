import { ALREADY_FILLED, isEmptyValue } from '../shared/step';
import { errorMessage, findOptionIndex } from '../shared/text';
import type {
  FieldDecision,
  FieldSchema,
  FieldValue,
  RunError,
  RunErrorCode,
  RunState,
} from '../shared/types';
import { LlmError, type LlmErrorKind } from './llm/client';
import { InjectionError } from './tab-gateway';

/** Fills of one field before giving up on correcting it: the first try plus two corrections. */
export const MAX_FILLS_PER_FIELD = 3;
const AUTO_ADVANCE_MIN_CONFIDENCE = 0.8;

const LLM_ERROR_CODES: Record<LlmErrorKind, RunErrorCode> = {
  auth: 'llm_auth',
  rate_limit: 'llm_rate_limit',
  unavailable: 'llm_unavailable',
  network: 'llm_network',
  refusal: 'llm_refusal',
  invalid_response: 'llm_invalid_response',
  bad_request: 'llm_bad_request',
};

/** Failure with a code the side panel knows how to explain. */
export class RunFailure extends Error {
  constructor(readonly code: RunErrorCode) {
    super(code);
  }
}

/** Raised at a checkpoint after the user asked the run to stop. */
export class RunCancelled extends Error {}

export function toRunError(error: unknown): RunError {
  if (error instanceof RunFailure) return { code: error.code };
  if (error instanceof InjectionError) return { code: 'injection_failed', detail: error.message };
  if (error instanceof LlmError) {
    return { code: LLM_ERROR_CODES[error.kind], detail: error.message };
  }
  return { code: 'unexpected', detail: errorMessage(error) };
}

/** Field types whose value is typed text, as opposed to a choice among what the page offers. */
const TYPED_FIELDS: ReadonlySet<FieldSchema['type']> = new Set([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'textarea',
  'combobox',
]);

export function holdsTypedText(field: FieldSchema): boolean {
  return TYPED_FIELDS.has(field.type);
}

/** Whether the extension itself put the current value into the field. */
export function wasFilledByExtension(decision: FieldDecision | undefined): boolean {
  return decision?.action === 'fill' && decision.origin !== 'user';
}

/** Whether the page lost a value that was filled before (after a reload, for instance). */
export function needsRefill(field: FieldSchema, decision: FieldDecision): boolean {
  if (decision.action !== 'fill' || field.error) return false;
  return typeof decision.value === 'boolean'
    ? field.value !== decision.value
    : isEmptyValue(field.value);
}

/**
 * Hides, from what is sent to the model, text the extension did not type: what the applicant
 * wrote by hand or the site filled in from their account. The model only needs to know the
 * field is answered. Choices are left as they are: they come from the page's own options.
 */
export function hideApplicantText(
  fields: readonly FieldSchema[],
  decided: RunState['decided'],
): FieldSchema[] {
  return fields.map((field) => {
    const typedByOthers =
      holdsTypedText(field) &&
      !field.options?.length &&
      !isEmptyValue(field.value) &&
      decided[field.id]?.action !== 'fill';
    return typedByOthers ? { ...field, value: ALREADY_FILLED } : field;
  });
}

/** Whether a reviewed step is safe to leave without the user looking at it. */
export function canAutoAdvance(state: RunState): boolean {
  const decisionsAreSafe = state.decisions.every(
    (decision) =>
      decision.action === 'skip' ||
      (decision.action === 'fill' &&
        !decision.needsReview &&
        decision.confidence >= AUTO_ADVANCE_MIN_CONFIDENCE),
  );
  return (
    decisionsAreSafe &&
    state.results.every((result) => result.status === 'filled') &&
    state.step?.blockedOrigins.length === 0 &&
    !state.shortfalls &&
    !state.notice
  );
}

/** Checks a value typed in the side panel against what the field can take. */
export function isValidAnswer(field: FieldSchema, value: FieldValue): boolean {
  if (field.type === 'checkbox') return typeof value === 'boolean';
  if (typeof value === 'boolean') return false;
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => item.trim() === '')) return false;
  return (
    !field.options?.length ||
    values.every((item) => findOptionIndex(field.options ?? [], item) !== -1)
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
