import { NATIVE_DATE_FORMATS } from '../extractor/widgets';
import { fillTextControl } from './native';

const NATIVE_PATTERNS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  'datetime-local': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
};

/**
 * Native date inputs silently discard values in any other format, so the format is checked
 * up front to report a useful error instead of an empty field.
 */
export function fillDate(input: HTMLInputElement, value: string): void {
  const pattern = NATIVE_PATTERNS[input.type];
  if (pattern && !pattern.test(value)) {
    throw new Error(`Expected the format ${NATIVE_DATE_FORMATS[input.type] ?? ''}, got "${value}"`);
  }
  fillTextControl(input, value);
}
