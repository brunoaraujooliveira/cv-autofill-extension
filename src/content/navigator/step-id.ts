import { collapseWhitespace, normalizeForMatch } from '../../shared/text';
import { queryAllDeep } from '../dom';
import { hasLayoutBox, isVisible, type BoxProbe } from '../extractor/visibility';

const CURRENT_STEP =
  '[aria-current="step"], [aria-current="page"], [role="tab"][aria-selected="true"]';
const HEADINGS = 'h1, h2';
const MAX_TITLE_LENGTH = 120;

/** Name of the step the user is on: the active item of a stepper or tab list, else the heading. */
export function findStepTitle(
  root: ParentNode,
  hasBox: BoxProbe = hasLayoutBox,
): string | undefined {
  for (const selector of [CURRENT_STEP, HEADINGS]) {
    const text = queryAllDeep(root, selector)
      .filter((element) => isVisible(element, hasBox))
      .map((element) => collapseWhitespace(element.textContent))
      .find((candidate) => candidate !== '' && candidate.length <= MAX_TITLE_LENGTH);
    if (text) return text;
  }
  return undefined;
}

/** Titles of the screen where an application is checked one last time before it is sent. */
const REVIEW_WORDS =
  /\b(review|revisao|rever|revisar|revision|confirmation|confirmacao|confirmacion|uberprufen|recapitulatif|riepilogo)\b/;

/**
 * Whether the page says this is the last step, whatever its buttons are called: the current
 * item of the stepper is the last one, or the step is named as the final review. A "Continue"
 * button here would send the application.
 */
export function looksLikeFinalStep(root: ParentNode, hasBox: BoxProbe = hasLayoutBox): boolean {
  const current = queryAllDeep(root, CURRENT_STEP).find((element) => isVisible(element, hasBox));
  if (current) {
    const items = Array.from(current.parentElement?.children ?? []).filter(
      (sibling) => sibling.tagName === current.tagName,
    );
    if (items.length > 1 && items.at(-1) === current) return true;
  }
  return REVIEW_WORDS.test(normalizeForMatch(findStepTitle(root, hasBox) ?? ''));
}
