import { collapseWhitespace, normalizeForMatch } from '../../shared/text';
import type { ButtonInfo, ButtonKind } from '../../shared/types';
import { queryAllDeep } from '../dom';
import { buildDeepSelector } from '../extractor/selector';
import { hasLayoutBox, isVisible, type BoxProbe } from '../extractor/visibility';

const BUTTONS = 'button, input[type="submit"], input[type="button"], [role="button"]';
const INSIDE_WIDGET = '[role="listbox"], [role="combobox"], [role="dialog"] [role="grid"]';

/** Elements many sites style and wire as buttons without making them one. */
const BUTTON_LOOKALIKES =
  '[class*="btn" i], [class*="button" i], a:not([href]), a[href="#"], a[href^="javascript:"]';
const FORM_CONTROLS = 'input, select, textarea, [role="combobox"]';
const MAX_LOOKALIKE_TEXT_LENGTH = 60;

/** Custom elements other browser extensions inject into pages; their buttons are not the form's. */
const INJECTED_UI = /grammarly|languagetool|^lt-|deepl|1password|lastpass|bitwarden|dashlane/i;

/** Words that send or finish an application. Matched on text without accents or punctuation. */
const SUBMIT_WORDS =
  /\b(submit|apply|send|finish|enviar|submeter|candidatar|candidatarme|finalizar|concluir|absenden|bewerben|einreichen|abschicken|envoyer|postuler|soumettre|invia|inviare|candidati|candidarsi|solicitar|postular)\b/;

/** Words that move to the next step without sending anything. */
const ADVANCE_WORDS =
  /\b(next|continue|proceed|seguinte|continuar|proximo|proxima|avancar|prosseguir|weiter|fortfahren|suivant|suivante|continuer|avanti|continua|prosegui|siguiente)\b/;

/**
 * Classifies a button by its text. Anything that may submit is "submit", even when it also
 * reads like "continue": a missed advance costs a click, a wrong submit cannot be undone.
 */
export function classifyButtonText(text: string): ButtonKind {
  const normalized = normalizeForMatch(text);
  if (SUBMIT_WORDS.test(normalized)) return 'submit';
  return ADVANCE_WORDS.test(normalized) ? 'advance' : 'other';
}

export function buttonText(button: Element): string {
  const value = button instanceof HTMLInputElement ? button.value : button.textContent;
  return collapseWhitespace(
    value || button.getAttribute('aria-label') || button.getAttribute('title') || '',
  );
}

export function isButtonDisabled(button: Element): boolean {
  return (
    button.matches(':disabled') ||
    button.getAttribute('aria-disabled') === 'true' ||
    button.classList.contains('disabled')
  );
}

export interface FoundButton {
  info: ButtonInfo;
  element: HTMLElement;
}

/**
 * A look-alike counts when it is the innermost one, holds nothing but a short text, and is
 * not just the styled inside of a real button.
 */
function isLookalikeButton(element: Element): boolean {
  if (element.matches(BUTTONS) || element.closest(BUTTONS)) return false;
  if (element.querySelector(`${BUTTONS}, ${BUTTON_LOOKALIKES}, ${FORM_CONTROLS}`)) return false;
  return buttonText(element).length <= MAX_LOOKALIKE_TEXT_LENGTH;
}

function isInjectedByAnotherExtension(element: Element): boolean {
  for (
    let root = element.getRootNode();
    root instanceof ShadowRoot;
    root = root.host.getRootNode()
  ) {
    if (INJECTED_UI.test(root.host.tagName)) return true;
  }
  return false;
}

/** Things that are clickable for another reason than being a button. */
const NOT_A_BUTTON =
  'label, summary, option, a[href], [role="tab"], [role="option"], [role="menuitem"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"]';

/**
 * A plain element the page made clickable, recognised by the pointer cursor when nothing in
 * its markup says "button". The cursor is inherited, so only the outermost element that has
 * it counts, and only when it holds nothing but a short text.
 */
function isClickableByCursor(element: Element): boolean {
  if (element.closest(`${BUTTONS}, ${NOT_A_BUTTON}`)) return false;
  const text = buttonText(element);
  if (text === '' || text.length > MAX_LOOKALIKE_TEXT_LENGTH) return false;
  if (element.querySelector(`${BUTTONS}, ${BUTTON_LOOKALIKES}, ${FORM_CONTROLS}`)) return false;
  if (getComputedStyle(element).cursor !== 'pointer') return false;
  const parent = element.parentElement;
  return !parent || getComputedStyle(parent).cursor !== 'pointer';
}

function isButtonLike(element: Element): boolean {
  if (element.matches(BUTTONS)) return true;
  if (element.matches(BUTTON_LOOKALIKES)) return isLookalikeButton(element);
  return isClickableByCursor(element);
}

/**
 * Visible buttons of the page with their classification: real buttons, elements named like
 * one, and elements that merely behave like one.
 */
export function findButtons(
  root: ParentNode,
  { frameId = 0, hasBox = hasLayoutBox }: { frameId?: number; hasBox?: BoxProbe } = {},
): FoundButton[] {
  return queryAllDeep<HTMLElement>(root, '*')
    .filter(isButtonLike)
    .filter((button) => !button.closest(INSIDE_WIDGET) && !isInjectedByAnotherExtension(button))
    .filter((button) => isVisible(button, hasBox))
    .map((element) => ({ element, text: buttonText(element) }))
    .filter(({ text }) => text !== '')
    .map(({ element, text }) => ({
      element,
      info: {
        frameId,
        selector: buildDeepSelector(element),
        text,
        kind: classifyButtonText(text),
        disabled: isButtonDisabled(element),
      },
    }));
}
