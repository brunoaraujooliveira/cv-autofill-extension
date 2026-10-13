import { collapseWhitespace, hashText } from '../../shared/text';
import type { FieldSchema } from '../../shared/types';
import { queryAllDeep } from '../dom';
import { readStaticOptions } from '../filler/combobox';
import { splitIntoBlocks } from './blocks';
import { GroupResolver, groupContainerLabel } from './grouping';
import { fromNearbyText, resolveLabel, type ResolvedLabel } from './label';
import { findFieldError } from '../validation';
import { buildDeepSelector, buildSelector } from './selector';
import { hasLayoutBox, isVisible, type BoxProbe } from './visibility';
import {
  classify,
  CONTROL_SELECTOR,
  isComboboxPart,
  isEditable,
  NATIVE_DATE_FORMATS,
} from './widgets';

/** A field as sent to the service worker, plus the live elements needed to fill it. */
export interface ExtractedField {
  schema: FieldSchema;
  /** One element, except for radio groups: one per option, in the order of `schema.options`. */
  elements: HTMLElement[];
}

export interface ExtractOptions {
  frameId?: number;
  hasBox?: BoxProbe;
  /** Opens a combobox to read options that only exist while its popup is open. */
  harvestOptions?: (combobox: HTMLElement) => Promise<string[]>;
}

const RADIO_CONTAINERS = 'fieldset, [role="radiogroup"]';

/** Native inputs that sites routinely hide behind a styled label the user clicks instead. */
const INPUTS_SHOWN_BY_THEIR_LABEL = ['radio', 'checkbox', 'file'];

function isControlVisible(control: HTMLElement, label: ResolvedLabel | null, hasBox: BoxProbe) {
  if (isVisible(control, hasBox)) return true;
  // The label is then what the user sees and uses, so it is the label that has to be visible.
  const shownByLabel =
    control instanceof HTMLInputElement && INPUTS_SHOWN_BY_THEIR_LABEL.includes(control.type);
  return shownByLabel && label?.element !== undefined && isVisible(label.element, hasBox);
}

function isRequired(control: Element, label: ResolvedLabel | null): boolean {
  return (
    control.matches(':required') ||
    control.getAttribute('aria-required') === 'true' ||
    (label?.hasRequiredMark ?? false)
  );
}

function selectedTexts(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions)
    .filter((option) => option.value !== '')
    .map((option) => option.text.trim());
}

function currentValue(control: HTMLElement): FieldSchema['value'] {
  if (control instanceof HTMLSelectElement) {
    const texts = selectedTexts(control);
    return control.multiple ? texts : (texts[0] ?? '');
  }
  if (control instanceof HTMLInputElement) {
    return control.type === 'checkbox' ? control.checked : control.value;
  }
  if (control instanceof HTMLTextAreaElement) return control.value;
  const inner = control.querySelector('input');
  return inner?.value ?? collapseWhitespace(control.textContent);
}

function selectOptions(select: HTMLSelectElement): string[] {
  return Array.from(select.options)
    .filter((option) => !option.disabled && option.value !== '')
    .map((option) => option.text.trim())
    .filter((text) => text !== '');
}

function placeholderOf(control: HTMLElement): string | undefined {
  const explicit = control.getAttribute('placeholder') ?? control.getAttribute('aria-placeholder');
  if (explicit) return explicit;
  return control instanceof HTMLInputElement ? NATIVE_DATE_FORMATS[control.type] : undefined;
}

function radioGroupKey(radio: HTMLInputElement): Element | string {
  if (radio.name) return `${buildSelector(radio.form ?? radio.ownerDocument.body)}|${radio.name}`;
  return radio.closest(RADIO_CONTAINERS) ?? radio;
}

function radioGroupLabel(radios: HTMLInputElement[]): ResolvedLabel | null {
  const [first] = radios;
  if (!first) return null;
  const container = first.closest(RADIO_CONTAINERS);
  if (container && radios.every((radio) => container.contains(radio))) {
    const text = groupContainerLabel(container);
    if (text !== '') {
      const raw = container.querySelector(':scope > legend')?.textContent ?? '';
      return { text, source: 'group-legend', hasRequiredMark: raw.includes('*') };
    }
  }
  const optionLabel = resolveLabel(first)?.element ?? first;
  return fromNearbyText(optionLabel.parentElement ?? optionLabel);
}

/**
 * Sections that hold several entries without labelling each one ("Course, Institution" twice
 * under a single heading) are split by structure, so each occurrence gets its own numbered
 * group and can be matched to a different resume entry.
 */
function numberRepeatedBlocks(fields: readonly ExtractedField[]): void {
  const sections = new Map<string, ExtractedField[]>();
  for (const field of fields) {
    const key = field.schema.group?.key ?? '';
    sections.set(key, [...(sections.get(key) ?? []), field]);
  }

  for (const members of sections.values()) {
    const items = members.flatMap((field) => {
      const [element] = field.elements;
      return element ? [{ element, key: `${field.schema.type}|${field.schema.label}` }] : [];
    });
    const blocks = splitIntoBlocks(items);
    if (!blocks) continue;
    for (const field of members) {
      const index = blocks.get(field.elements[0] as Element);
      if (index === undefined) continue;
      const section = field.schema.group;
      field.schema.group = section
        ? { key: `${section.key}-${index}`, label: `${section.label} ${index + 1}`, index }
        : { key: `entry-${index}`, label: `Entry ${index + 1}`, index };
    }
  }
}

type Entry =
  | {
      kind: 'control';
      control: HTMLElement;
      type: FieldSchema['type'];
      label: ResolvedLabel | null;
    }
  | { kind: 'radios'; radios: HTMLInputElement[] };

class FieldCollector {
  private readonly usedIds = new Set<string>();
  private readonly groups = new GroupResolver();
  private readonly frameId: number;
  private readonly hasBox: BoxProbe;

  constructor(private readonly options: ExtractOptions) {
    this.frameId = options.frameId ?? 0;
    this.hasBox = options.hasBox ?? hasLayoutBox;
  }

  async collect(root: ParentNode): Promise<ExtractedField[]> {
    const fields: ExtractedField[] = [];
    for (const entry of this.findEntries(root)) {
      if (entry.kind === 'radios') {
        fields.push({ schema: this.describeRadioGroup(entry.radios), elements: entry.radios });
      } else {
        const schema = await this.describeControl(entry.control, entry.type, entry.label);
        fields.push({ schema, elements: [entry.control] });
      }
    }
    numberRepeatedBlocks(fields);
    return fields;
  }

  /** Visible, editable controls in document order, with the radios of a group merged into one entry. */
  private findEntries(root: ParentNode): Entry[] {
    const entries: Entry[] = [];
    const radioGroups = new Map<Element | string, HTMLInputElement[]>();

    for (const control of queryAllDeep<HTMLElement>(root, CONTROL_SELECTOR)) {
      const type = classify(control);
      if (!type || !isEditable(control) || isComboboxPart(control)) continue;
      const label = resolveLabel(control);
      if (!isControlVisible(control, label, this.hasBox)) continue;

      if (control instanceof HTMLInputElement && type === 'radio') {
        const key = radioGroupKey(control);
        const radios = radioGroups.get(key);
        if (radios) {
          radios.push(control);
        } else {
          const group = [control];
          radioGroups.set(key, group);
          entries.push({ kind: 'radios', radios: group });
        }
      } else {
        entries.push({ kind: 'control', control, type, label });
      }
    }
    return entries;
  }

  private async describeControl(
    control: HTMLElement,
    type: FieldSchema['type'],
    label: ResolvedLabel | null,
  ): Promise<FieldSchema> {
    const options = await this.optionsOf(control, type);
    const placeholder = placeholderOf(control);
    const group = this.groups.resolve(control);
    return {
      ...this.identity(buildDeepSelector(control), label),
      type,
      required: isRequired(control, label),
      value: currentValue(control),
      ...(options.length > 0 ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(group ? { group } : {}),
      ...this.errorOf([control]),
    };
  }

  private describeRadioGroup(radios: HTMLInputElement[]): FieldSchema {
    const [first] = radios as [HTMLInputElement, ...HTMLInputElement[]];
    const label = radioGroupLabel(radios);
    const options = radios.map((radio) => resolveLabel(radio)?.text ?? radio.value);
    const checked = radios.findIndex((radio) => radio.checked);
    const container = first.closest(RADIO_CONTAINERS);
    const usedContainerAsLabel = label?.source === 'group-legend';
    const group = this.groups.resolve(
      usedContainerAsLabel ? (container?.parentElement ?? null) : first,
    );
    return {
      ...this.identity(buildDeepSelector(first), label),
      type: 'radio',
      required:
        radios.some((radio) => radio.required) ||
        container?.getAttribute('aria-required') === 'true' ||
        (label?.hasRequiredMark ?? false),
      value: options[checked] ?? '',
      options,
      ...(group ? { group } : {}),
      ...this.errorOf(radios),
    };
  }

  private errorOf(controls: readonly Element[]): { error?: string } {
    const error = findFieldError(controls, this.hasBox);
    return error ? { error } : {};
  }

  private async optionsOf(control: HTMLElement, type: FieldSchema['type']): Promise<string[]> {
    if (control instanceof HTMLSelectElement) return selectOptions(control);
    if (type !== 'combobox') return [];
    const present = readStaticOptions(control);
    if (present.length > 0) return present;
    return (await this.options.harvestOptions?.(control)) ?? [];
  }

  private identity(selector: string, label: ResolvedLabel | null) {
    const text = label?.text ?? '';
    const base = `f${hashText(`${this.frameId}|${selector}|${text}`)}`;
    let id = base;
    for (let suffix = 2; this.usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    this.usedIds.add(id);
    return {
      id,
      frameId: this.frameId,
      origin: location.origin,
      selector,
      label: text,
      labelSource: label?.source ?? 'name-attribute',
    } satisfies Partial<FieldSchema>;
  }
}

/** Reads every visible, editable field under `root` in document order. */
export function extractFields(
  root: ParentNode,
  options: ExtractOptions = {},
): Promise<ExtractedField[]> {
  return new FieldCollector(options).collect(root);
}
