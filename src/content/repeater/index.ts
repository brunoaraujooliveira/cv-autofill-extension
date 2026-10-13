import { normalizeForMatch } from '../../shared/text';
import type { RepeatableKind, RepeatableSection } from '../../shared/types';
import { queryAllDeep, waitFor } from '../dom';
import { splitIntoBlocks } from '../extractor/blocks';
import { CONTROL_SELECTOR } from '../extractor/widgets';
import { resolveLabel } from '../extractor/label';
import { hasLayoutBox, isVisible, type BoxProbe } from '../extractor/visibility';
import type { FoundButton } from '../navigator/buttons';

const ADD_WORDS =
  /^(add|adicionar|acrescentar|incluir|nova|novo|ajouter|hinzufugen|aggiungi|anadir|agregar)\b/;

const KIND_WORDS: [RepeatableKind, RegExp][] = [
  [
    'work',
    /(experience|experiencia|employment|emprego|work history|job history|beruf|esperienza|emploi)/,
  ],
  [
    'education',
    /(education|educacao|formacao|school|escola|degree|academic|curso|course|qualifica|institu|universi|ausbildung|formation|istruzione)/,
  ],
  ['languages', /(language|idioma|lingua|sprache|langue)/],
  ['certificates', /(certif|licen)/],
];

const SECTION_CONTAINERS = 'fieldset, section, [role="group"], [data-section], form, body';
const SECTION_HEADINGS = ':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4';
const NEW_BLOCK_TIMEOUT_MS = 5000;

function isAddButton(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('+') || ADD_WORDS.test(normalizeForMatch(trimmed));
}

function kindsOf(text: string): RepeatableKind[] {
  const normalized = normalizeForMatch(text);
  return KIND_WORDS.filter(([, words]) => words.test(normalized)).map(([kind]) => kind);
}

/** Kinds named by the heading of the nearest section around the button that names any. */
function headingKindsOf(button: Element): RepeatableKind[] {
  for (
    let container = button.closest(SECTION_CONTAINERS);
    container;
    container = container.parentElement?.closest(SECTION_CONTAINERS) ?? null
  ) {
    const kinds = kindsOf(container.querySelector(SECTION_HEADINGS)?.textContent ?? '');
    if (kinds.length > 0) return kinds;
  }
  return [];
}

/**
 * What the button repeats. Its own text decides; the section heading only adds to it when
 * both talk about the same thing ("Add another course" under "Courses and certifications"),
 * so a heading shared by several lists is not credited to each of them.
 */
function repeatedKinds(text: string, button: Element): RepeatableKind[] {
  const named = kindsOf(text);
  const heading = headingKindsOf(button);
  if (named.length === 0) return heading;
  return heading.some((kind) => named.includes(kind))
    ? [...new Set([...named, ...heading])]
    : named;
}

function visibleControls(container: ParentNode, hasBox: BoxProbe): Element[] {
  return queryAllDeep(container, CONTROL_SELECTOR).filter((control) => isVisible(control, hasBox));
}

/**
 * Controls of the list the button adds to: what comes before the button, walking outwards
 * until something is found, and never past another "Add" button (that is another list).
 */
function controlsBefore(
  button: Element,
  addButtons: ReadonlySet<Element>,
  hasBox: BoxProbe,
): Element[] {
  const belongsToAnotherList = (element: Element) =>
    [...addButtons].some((other) => other !== button && element.contains(other));

  for (
    let node: Element | null = button;
    node && !node.matches('form, body');
    node = node.parentElement
  ) {
    const controls: Element[] = [];
    for (
      let sibling = node.previousElementSibling;
      sibling && !belongsToAnotherList(sibling);
      sibling = sibling.previousElementSibling
    ) {
      controls.unshift(...visibleControls(sibling, hasBox));
    }
    if (controls.length > 0) return controls;
  }
  return [];
}

/** Blocks already in the list: one, unless its questions repeat. */
function countBlocks(controls: readonly Element[]): number {
  if (controls.length === 0) return 0;
  const items = controls.map((element) => ({ element, key: resolveLabel(element)?.text ?? '' }));
  const blocks = splitIntoBlocks(items.filter((item) => item.key !== ''));
  return blocks ? new Set(blocks.values()).size : 1;
}

/** "Add" buttons that repeat a section of the resume, with how many blocks each already has. */
export function findRepeatables(
  buttons: readonly FoundButton[],
  hasBox: BoxProbe = hasLayoutBox,
): RepeatableSection[] {
  const candidates = buttons.filter(
    ({ info }) => info.kind === 'other' && !info.disabled && isAddButton(info.text),
  );
  const addButtons = new Set<Element>(candidates.map(({ element }) => element));

  return candidates.flatMap(({ info, element }) => {
    const kinds = repeatedKinds(info.text, element);
    if (kinds.length === 0) return [];
    return {
      frameId: info.frameId,
      selector: info.selector,
      text: info.text,
      kinds,
      existingBlocks: countBlocks(controlsBefore(element, addButtons, hasBox)),
    };
  });
}

/** Clicks an "Add" button and waits for the new block's fields to show up. */
export async function addBlock(
  button: HTMLElement,
  { hasBox = hasLayoutBox, timeoutMs = NEW_BLOCK_TIMEOUT_MS } = {},
): Promise<boolean> {
  const before = visibleControls(document, hasBox).length;
  button.click();
  const grew = await waitFor(() => visibleControls(document, hasBox).length > before, {
    timeoutMs,
  });
  return grew === true;
}
