import { collapseWhitespace, isFormatHint } from '../../shared/text';
import type { LabelSource } from '../../shared/types';
import { cssEscape } from '../dom';

export interface ResolvedLabel {
  text: string;
  source: LabelSource;
  /** The label carries an asterisk, the usual visual marker for required fields. */
  hasRequiredMark: boolean;
  element?: Element;
}

const CONTROLS = 'input, select, textarea, button, [role="combobox"], [role="listbox"]';
const NEARBY_TEXT_MAX_LENGTH = 120;
const NEARBY_TEXT_MAX_DEPTH = 4;
const NEARBY_TEXT_BOUNDARY = 'form, fieldset, body';

type QueryRoot = Document | ShadowRoot;

function queryRootOf(element: Element): QueryRoot {
  return element.getRootNode() as QueryRoot;
}

/** Visible text of a node, leaving out the text that belongs to form controls inside it. */
export function textWithoutControls(node: Node): string {
  if (!(node instanceof Element)) return collapseWhitespace(node.textContent ?? '');
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll(CONTROLS).forEach((control) => {
    control.remove();
  });
  return collapseWhitespace(clone.textContent);
}

function toLabel(raw: string, source: LabelSource, element?: Element): ResolvedLabel | null {
  const text = collapseWhitespace(raw.replace(/\*/g, ' ')).replace(/\s*:$/, '');
  if (text === '') return null;
  return { text, source, hasRequiredMark: raw.includes('*'), ...(element ? { element } : {}) };
}

function fromLabelFor(control: Element): ResolvedLabel | null {
  if (!control.id) return null;
  const label = queryRootOf(control).querySelector(`label[for="${cssEscape(control.id)}"]`);
  return label ? toLabel(textWithoutControls(label), 'label-for', label) : null;
}

function fromWrappingLabel(control: Element): ResolvedLabel | null {
  const label = control.closest('label');
  return label ? toLabel(textWithoutControls(label), 'label-wrap', label) : null;
}

export function fromAriaLabelledBy(control: Element): ResolvedLabel | null {
  const ids = control.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
  const root = queryRootOf(control);
  const text = ids
    .map((id) => root.querySelector(`#${cssEscape(id)}`))
    .filter((element) => element !== null)
    .map((element) => textWithoutControls(element))
    .join(' ');
  return toLabel(text, 'aria-labelledby');
}

export function fromAriaLabel(control: Element): ResolvedLabel | null {
  return toLabel(control.getAttribute('aria-label') ?? '', 'aria-label');
}

function fromPlaceholder(control: Element): ResolvedLabel | null {
  const placeholder =
    control.getAttribute('placeholder') ?? control.getAttribute('aria-placeholder') ?? '';
  return toLabel(placeholder, 'placeholder');
}

/** Closest text that comes before the control, searching outwards a few levels. */
export function fromNearbyText(control: Element): ResolvedLabel | null {
  let node: Element | null = control;
  for (let depth = 0; node && depth < NEARBY_TEXT_MAX_DEPTH; depth += 1) {
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
      const isControl = sibling instanceof Element && sibling.matches(CONTROLS);
      // Text that sits with another control is that control's label, and so is all before it.
      if (!isControl && sibling instanceof Element && sibling.querySelector(CONTROLS)) return null;
      const text = isControl ? '' : textWithoutControls(sibling);
      if (text !== '' && text.length <= NEARBY_TEXT_MAX_LENGTH) {
        return toLabel(text, 'nearby-text', sibling instanceof Element ? sibling : undefined);
      }
    }
    if (node.matches(NEARBY_TEXT_BOUNDARY)) return null;
    node = node.parentElement;
  }
  return null;
}

function fromNameAttribute(control: Element): ResolvedLabel | null {
  const name = control.getAttribute('name') ?? control.id;
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]]+/g, ' ')
    .toLowerCase();
  return toLabel(words, 'name-attribute');
}

/** A placeholder that names the field ("City"), as opposed to one showing a format. */
function fromNamingPlaceholder(control: Element): ResolvedLabel | null {
  const label = fromPlaceholder(control);
  return label && !isFormatHint(label.text) ? label : null;
}

/**
 * A <label> placed beside the control but not wired to it (no "for", or one that points
 * nowhere). It was written as this field's label, so it outranks the placeholder, which on
 * such forms is usually an example of what to type.
 */
function fromOrphanLabel(control: Element): ResolvedLabel | null {
  const nearby = fromNearbyText(control);
  const label = nearby?.element?.matches('label')
    ? nearby.element
    : nearby?.element?.querySelector('label');
  if (!nearby || !(label instanceof HTMLLabelElement)) return null;
  const target = label.htmlFor
    ? queryRootOf(control).querySelector(`#${cssEscape(label.htmlFor)}`)
    : null;
  return target && target !== control ? null : nearby;
}

const RESOLVERS = [
  fromLabelFor,
  fromWrappingLabel,
  fromAriaLabelledBy,
  fromAriaLabel,
  fromOrphanLabel,
  fromNamingPlaceholder,
  fromNearbyText,
  // "dd-mm-yyyy" says how to answer, not what is asked: only better than nothing.
  fromPlaceholder,
  fromNameAttribute,
];

/** Resolves the label in order of reliability; null when the control has no usable name at all. */
export function resolveLabel(control: Element): ResolvedLabel | null {
  for (const resolver of RESOLVERS) {
    const label = resolver(control);
    if (label) return label;
  }
  return null;
}
