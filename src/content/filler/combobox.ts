import { collapseWhitespace, findOptionIndex, normalizeForMatch } from '../../shared/text';
import { clickLikeUser, cssEscape, pressKey, waitFor } from '../dom';
import { isVisible, type BoxProbe } from '../extractor/visibility';
import { setNativeValue } from './native';

const OPTIONS_TIMEOUT_MS = 2500;
/** Reading options is optional, so it gives up sooner than filling does. */
const HARVEST_TIMEOUT_MS = 1000;
/** Suggestions for free text are a bonus; not worth a long wait when none come. */
const FREE_TEXT_TIMEOUT_MS = 800;
/** Longer lists are almost certainly search-driven; reading them all would not help the mapper. */
const MAX_HARVESTED_OPTIONS = 150;

export interface ComboboxContext {
  hasBox?: BoxProbe;
  timeoutMs?: number;
  /** The combobox only suggests: a value outside its options may be typed in. */
  allowFreeText?: boolean;
}

type QueryRoot = Document | ShadowRoot;

function searchInputOf(combobox: HTMLElement): HTMLInputElement | null {
  if (combobox instanceof HTMLInputElement) return combobox;
  return combobox.querySelector('input:not([type="hidden"])');
}

function isExpanded(combobox: HTMLElement): boolean {
  const input = searchInputOf(combobox);
  return [combobox, input].some((element) => element?.getAttribute('aria-expanded') === 'true');
}

/** The popup the combobox points at, or the only listbox currently on screen. */
function findListbox(combobox: HTMLElement, hasBox?: BoxProbe): Element | null {
  const root = combobox.getRootNode() as QueryRoot;
  for (const element of [combobox, searchInputOf(combobox)]) {
    const id = element?.getAttribute('aria-controls') ?? element?.getAttribute('aria-owns');
    const listbox = id ? root.querySelector(`#${cssEscape(id)}`) : null;
    if (listbox) return listbox;
  }
  const visible = Array.from(document.querySelectorAll('[role="listbox"]')).filter((listbox) =>
    isVisible(listbox, hasBox),
  );
  return visible.at(-1) ?? null;
}

function visibleOptions(combobox: HTMLElement, hasBox?: BoxProbe): HTMLElement[] {
  const listbox = findListbox(combobox, hasBox);
  if (!listbox || !isVisible(listbox, hasBox)) return [];
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).filter(
    (option) => option.getAttribute('aria-disabled') !== 'true' && isVisible(option, hasBox),
  );
}

const optionText = (option: HTMLElement) => collapseWhitespace(option.textContent);

/** Options present in the DOM without opening the popup (rare, but free when available). */
export function readStaticOptions(combobox: HTMLElement): string[] {
  const listbox = findListbox(combobox, () => true);
  if (!listbox) return [];
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
    .map(optionText)
    .filter((text) => text !== '');
}

async function open(combobox: HTMLElement, context: ComboboxContext): Promise<HTMLElement[]> {
  const waitOptions = { timeoutMs: context.timeoutMs ?? OPTIONS_TIMEOUT_MS };
  const hasOptions = () => {
    const options = visibleOptions(combobox, context.hasBox);
    return options.length > 0 ? options : null;
  };

  (searchInputOf(combobox) ?? combobox).focus();
  if (!isExpanded(combobox)) clickLikeUser(combobox);
  const afterClick = await waitFor(hasOptions, { timeoutMs: waitOptions.timeoutMs / 2 });
  if (afterClick) return afterClick;

  pressKey(searchInputOf(combobox) ?? combobox, 'ArrowDown');
  return (await waitFor(hasOptions, { timeoutMs: waitOptions.timeoutMs / 2 })) ?? [];
}

function close(combobox: HTMLElement): void {
  if (isExpanded(combobox)) pressKey(searchInputOf(combobox) ?? combobox, 'Escape');
}

/** Opens the popup just to read what it offers, then closes it again. */
export async function harvestOptions(
  combobox: HTMLElement,
  context: ComboboxContext = {},
): Promise<string[]> {
  const patient = { ...context, timeoutMs: context.timeoutMs ?? HARVEST_TIMEOUT_MS };
  const options = (await open(combobox, patient)).map(optionText).filter((text) => text !== '');
  close(combobox);
  return options.length <= MAX_HARVESTED_OPTIONS ? options : [];
}

function pickOption(options: HTMLElement[], wanted: string): HTMLElement | null {
  const texts = options.map(optionText);
  const exact = findOptionIndex(texts, wanted);
  if (exact !== -1) return options[exact] ?? null;
  const target = normalizeForMatch(wanted);
  const partial = options.filter((_, index) =>
    normalizeForMatch(texts[index] ?? '').includes(target),
  );
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

/** Keeps what was typed as the answer of a combobox that takes free text. */
function commitFreeText(combobox: HTMLElement, input: HTMLInputElement, value: string): void {
  close(combobox);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  if (input.value !== value) throw new Error(`The field did not keep the text "${value}"`);
}

/**
 * Opens the combobox, types to filter when it has a search box, and clicks the matching
 * option. With `allowFreeText` (a combobox that suggests instead of restricting), the typed
 * text stands as the answer when no suggestion matches it.
 */
export async function fillCombobox(
  combobox: HTMLElement,
  value: string,
  context: ComboboxContext = {},
): Promise<void> {
  const timeoutMs =
    context.timeoutMs ?? (context.allowFreeText ? FREE_TEXT_TIMEOUT_MS : OPTIONS_TIMEOUT_MS);
  let options = await open(combobox, { ...context, timeoutMs });
  let match = pickOption(options, value);

  const input = searchInputOf(combobox);
  if (!match && input && !input.readOnly) {
    setNativeValue(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    match = await waitFor(() => pickOption(visibleOptions(combobox, context.hasBox), value), {
      timeoutMs,
    });
    options = visibleOptions(combobox, context.hasBox);
  }

  if (!match && input && !input.readOnly && context.allowFreeText) {
    commitFreeText(combobox, input, value);
    return;
  }

  if (!match) {
    if (input && !input.readOnly) {
      setNativeValue(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    close(combobox);
    const offered = options.map(optionText).slice(0, 10).join(', ');
    throw new Error(`No option matches "${value}"${offered ? ` (offered: ${offered})` : ''}`);
  }

  clickLikeUser(match);
  await waitFor(() => !isExpanded(combobox) || !match.isConnected, { timeoutMs: timeoutMs / 2 });
  close(combobox);
}
