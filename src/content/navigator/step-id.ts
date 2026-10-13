import { collapseWhitespace } from '../../shared/text';
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
