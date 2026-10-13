import { findOptionIndex } from '../../shared/text';

/** Clicks instead of assigning `checked`, so the page's own handlers run. */
export function fillCheckbox(checkbox: HTMLInputElement, checked: boolean): void {
  if (checkbox.checked !== checked) checkbox.click();
  if (checkbox.checked !== checked) throw new Error('The checkbox did not change when clicked');
}

/** `radios` and `options` are parallel: options[i] is the label of radios[i]. */
export function fillRadioGroup(
  radios: readonly HTMLInputElement[],
  options: readonly string[],
  value: string,
): void {
  const radio = radios[findOptionIndex(options, value)];
  if (!radio) throw new Error(`No option matches "${value}"`);
  if (!radio.checked) radio.click();
  if (!radio.checked) throw new Error('The option did not get selected when clicked');
}
