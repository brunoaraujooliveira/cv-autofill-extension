import { hashText } from './text';
import type { FieldDecision, FieldSchema, StepSchema } from './types';

/** Identifies a step by what it asks, not by the values typed into it. */
export function stepSignature(fields: readonly FieldSchema[], title = ''): string {
  const labels = fields.map((field) => `${field.type}:${field.label}`).sort();
  return hashText([title, ...labels].join('\n'));
}

export function hasAdvanceButton(step: StepSchema): boolean {
  return step.buttons.some((button) => button.kind === 'advance');
}

/**
 * A step the extension must not move on from: the page presents it as the last one, or its
 * only way forward is a button that submits.
 */
export function isFinalStep(step: StepSchema): boolean {
  if (step.looksFinal) return true;
  return step.buttons.some((button) => button.kind === 'submit') && !hasAdvanceButton(step);
}

export function isEmptyValue(value: FieldSchema['value']): boolean {
  return value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

/** Key under which what was learnt about a field is remembered across pages of the same portal. */
export function fieldKey(field: FieldSchema): string {
  return `${field.type}|${field.label}|${field.group?.index ?? ''}`;
}

/** The decision for a field that is left to the user, with the reason shown beside it. */
export function askUser(fieldId: string, reason: string): FieldDecision {
  return { fieldId, action: 'ask_user', confidence: 0, reason };
}

/** What the model is shown instead of text the extension did not put in the field itself. */
export const ALREADY_FILLED = '[already filled in]';
