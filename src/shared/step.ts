import { hashText } from './text';
import type { FieldSchema, StepSchema } from './types';

/** Identifies a step by what it asks, not by the values typed into it. */
export function stepSignature(fields: readonly FieldSchema[], title = ''): string {
  const labels = fields.map((field) => `${field.type}:${field.label}`).sort();
  return hashText([title, ...labels].join('\n'));
}

export function hasAdvanceButton(step: StepSchema): boolean {
  return step.buttons.some((button) => button.kind === 'advance');
}

/** A step whose only way forward is to submit: the extension stops here. */
export function isFinalStep(step: StepSchema): boolean {
  return step.buttons.some((button) => button.kind === 'submit') && !hasAdvanceButton(step);
}

export function isEmptyValue(value: FieldSchema['value']): boolean {
  return value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

/** Key under which what was learnt about a field is remembered across pages of the same portal. */
export function fieldKey(field: FieldSchema): string {
  return `${field.type}|${field.label}|${field.group?.index ?? ''}`;
}
