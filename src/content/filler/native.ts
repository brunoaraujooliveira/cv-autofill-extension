import { findOptionIndex } from '../../shared/text';

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Sets `value` through the prototype setter. Frameworks such as React replace the instance
 * setter to track changes, so a plain assignment would be ignored on the next render.
 */
export function setNativeValue(element: ValueElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with .call below
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

function dispatchEdited(element: Element): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function dispatchLeft(element: Element): void {
  element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

export function fillTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  element.focus();
  setNativeValue(element, value);
  dispatchEdited(element);
  dispatchLeft(element);
  if (value !== '' && element.value === '') {
    throw new Error(`The field rejected the value "${value}"`);
  }
}

function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.text.trim());
}

function findOption(select: HTMLSelectElement, wanted: string): HTMLOptionElement {
  const options = Array.from(select.options);
  const index = findOptionIndex(optionLabels(select), wanted);
  const option = options[index] ?? options.find((candidate) => candidate.value === wanted);
  if (!option) throw new Error(`No option matches "${wanted}"`);
  return option;
}

export function fillSelect(select: HTMLSelectElement, value: string | string[]): void {
  select.focus();
  if (select.multiple) {
    const wanted = new Set(
      (Array.isArray(value) ? value : [value]).map((v) => findOption(select, v)),
    );
    for (const option of Array.from(select.options)) option.selected = wanted.has(option);
  } else {
    const single = Array.isArray(value) ? (value[0] ?? '') : value;
    setNativeValue(select, findOption(select, single).value);
  }
  dispatchEdited(select);
  dispatchLeft(select);
}
