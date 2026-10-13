import type { FieldType } from '../../shared/types';

export const CONTROL_SELECTOR = 'input, select, textarea, [role="combobox"]';

const INPUT_TYPES: Record<string, FieldType> = {
  text: 'text',
  search: 'text',
  url: 'text',
  email: 'email',
  tel: 'tel',
  number: 'number',
  date: 'date',
  month: 'date',
  'datetime-local': 'date',
  radio: 'radio',
  checkbox: 'checkbox',
  file: 'file',
};

/** Value format native date inputs require, used as a hint when the field has no placeholder. */
export const NATIVE_DATE_FORMATS: Record<string, string> = {
  date: 'YYYY-MM-DD',
  month: 'YYYY-MM',
  'datetime-local': 'YYYY-MM-DDTHH:mm',
};

export function isCombobox(element: Element): boolean {
  return element.getAttribute('role') === 'combobox' && !(element instanceof HTMLSelectElement);
}

/** Field type of a control, or null for controls the extension never touches (password, hidden…). */
export function classify(element: Element): FieldType | null {
  if (isCombobox(element)) return 'combobox';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLInputElement) return INPUT_TYPES[element.type] ?? null;
  return null;
}

/** A text input inside a combobox wrapper is part of that combobox, not a field of its own. */
export function isComboboxPart(element: Element): boolean {
  const wrapper = element.parentElement?.closest('[role="combobox"]');
  return wrapper !== null && wrapper !== undefined;
}

export function isEditable(element: Element): boolean {
  if (element.matches(':disabled') || element.closest('fieldset[disabled]')) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  const readOnly = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  return !(readOnly && element.readOnly);
}
