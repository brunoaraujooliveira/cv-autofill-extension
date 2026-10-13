import { collapseWhitespace } from '../../shared/text';
import { cssEscape } from '../dom';
import { isVisible, type BoxProbe } from '../extractor/visibility';

const ERROR_ELEMENTS =
  '[role="alert"], [aria-live="assertive"], [class*="error" i], [class*="invalid" i], [class*="danger" i]';
const MAX_MESSAGE_LENGTH = 200;
/** How far up from the control a message is still considered to belong to it. */
const MAX_WRAPPER_DEPTH = 3;
const CONTROLS = 'input:not([type="hidden"]), select, textarea, [role="combobox"]';

type QueryRoot = Document | ShadowRoot;

function messageOf(element: Element | null, hasBox?: BoxProbe): string | undefined {
  if (!element || !isVisible(element, hasBox)) return undefined;
  const text = collapseWhitespace(element.textContent);
  return text !== '' && text.length <= MAX_MESSAGE_LENGTH ? text : undefined;
}

function referenced(control: Element, attribute: string): Element[] {
  const root = control.getRootNode() as QueryRoot;
  return (control.getAttribute(attribute)?.split(/\s+/).filter(Boolean) ?? [])
    .map((id) => root.querySelector(`#${cssEscape(id)}`))
    .filter((element) => element !== null);
}

function fromAria(control: Element, hasBox?: BoxProbe): string | undefined {
  const isInvalid = control.getAttribute('aria-invalid') === 'true';
  for (const element of referenced(control, 'aria-errormessage')) {
    const message = messageOf(element, hasBox);
    if (message) return message;
  }
  for (const element of referenced(control, 'aria-describedby')) {
    // A description is only an error when the field says it is invalid or the element looks like one.
    if (!isInvalid && !element.matches(ERROR_ELEMENTS)) continue;
    const message = messageOf(element, hasBox);
    if (message) return message;
  }
  return undefined;
}

/** Error element in the smallest wrapper that holds this control and no other. */
function fromNearbyElement(controls: readonly Element[], hasBox?: BoxProbe): string | undefined {
  const [first] = controls;
  let wrapper = first?.parentElement;
  for (let depth = 0; wrapper && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    const others = Array.from(wrapper.querySelectorAll(CONTROLS)).filter(
      (control) => !controls.includes(control),
    );
    if (others.length > 0) return undefined;
    for (const candidate of Array.from(wrapper.querySelectorAll(ERROR_ELEMENTS))) {
      if (controls.some((control) => candidate.contains(control))) continue;
      const message = messageOf(candidate, hasBox);
      if (message) return message;
    }
    wrapper = wrapper.parentElement;
  }
  return undefined;
}

function fromNativeValidity(control: Element): string | undefined {
  const isNative =
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement;
  if (!isNative || control.validity.valid) return undefined;
  // A required field left empty or unchecked is not a rejected value; it is just not answered yet.
  if (control.validity.valueMissing) return undefined;
  return control.validationMessage || undefined;
}

/**
 * Validation message the page is currently showing for a field, if any.
 * `controls` is the field's element, or every radio of a group.
 */
export function findFieldError(
  controls: readonly Element[],
  hasBox?: BoxProbe,
): string | undefined {
  for (const control of controls) {
    const message = fromAria(control, hasBox);
    if (message) return message;
  }
  return fromNearbyElement(controls, hasBox) ?? controls.map(fromNativeValidity).find(Boolean);
}
