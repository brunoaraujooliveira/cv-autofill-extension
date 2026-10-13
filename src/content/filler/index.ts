import type { FieldDecision, FillResult, UploadFile } from '../../shared/types';
import { sleep as defaultSleep } from '../dom';
import type { ExtractedField } from '../extractor';
import { fillCheckbox, fillRadioGroup } from './choice';
import { fillCombobox, type ComboboxContext } from './combobox';
import { fillDate } from './date';
import { attachFile } from './file';
import { fillSelect, fillTextControl } from './native';

export interface FillContext {
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
  combobox?: ComboboxContext;
  /** The applicant's resume file, when one is stored, for upload fields. */
  file?: UploadFile;
}

type Value = NonNullable<FieldDecision['value']>;

const CHOICE_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'file']);

/** Raised when the field needs the user: it is reported as pending, not as a failure. */
class ManualStepRequired extends Error {}

function asText(value: Value): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  throw new Error('Expected a text value, got a boolean');
}

/** Empties a field that holds typed text; fields that hold a choice are left as they are. */
function clearTypedText(element: HTMLElement): void {
  const input =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element
      : element.querySelector('input');
  const isTyped = input && !(input instanceof HTMLInputElement && CHOICE_INPUTS.has(input.type));
  if (isTyped && input.value !== '') fillTextControl(input, '');
}

async function applyValue(field: ExtractedField, value: Value, context: FillContext) {
  const [element] = field.elements;
  if (!element?.isConnected) throw new Error('The field is no longer on the page');
  // An empty value never comes from a decision to fill: it asks for the field to be emptied.
  if (value === '') {
    clearTypedText(element);
    return;
  }

  switch (field.schema.type) {
    case 'checkbox':
      if (typeof value !== 'boolean') throw new Error('Expected true or false');
      fillCheckbox(element as HTMLInputElement, value);
      return;
    case 'radio':
      fillRadioGroup(
        field.elements as HTMLInputElement[],
        field.schema.options ?? [],
        asText(value),
      );
      return;
    case 'select':
      fillSelect(element as HTMLSelectElement, typeof value === 'boolean' ? String(value) : value);
      return;
    case 'combobox':
      // Without a list of options to choose from, the combobox is taken to accept typed text.
      await fillCombobox(element, asText(value), {
        ...context.combobox,
        allowFreeText: !field.schema.options?.length,
      });
      return;
    case 'date':
      fillDate(element as HTMLInputElement, asText(value));
      return;
    case 'file':
      if (!context.file) throw new ManualStepRequired('No resume file is stored in the options');
      try {
        attachFile(element as HTMLInputElement, context.file);
      } catch (error) {
        throw new ManualStepRequired(error instanceof Error ? error.message : String(error));
      }
      return;
    default:
      fillTextControl(element as HTMLInputElement | HTMLTextAreaElement, asText(value));
  }
}

/** Applies the "fill" decisions one field at a time, in order, and reports what happened to each. */
export async function fillFields(
  fields: ReadonlyMap<string, ExtractedField>,
  decisions: readonly FieldDecision[],
  context: FillContext,
): Promise<FillResult[]> {
  const sleep = context.sleep ?? defaultSleep;
  const results: FillResult[] = [];

  for (const decision of decisions) {
    if (decision.action !== 'fill' || decision.value === undefined) continue;
    const field = fields.get(decision.fieldId);
    try {
      if (!field) throw new Error('Unknown field');
      await applyValue(field, decision.value, context);
      results.push({ fieldId: decision.fieldId, status: 'filled' });
    } catch (error) {
      results.push({
        fieldId: decision.fieldId,
        status: error instanceof ManualStepRequired ? 'pending_manual' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(context.delayMs);
  }
  return results;
}
