import { parentAcrossShadow } from '../dom';

/** Tells whether an element occupies space on screen. Injectable because test DOMs have no layout. */
export type BoxProbe = (element: Element) => boolean;

/** Smaller than this in either direction and nobody could see or use the element. */
const MIN_VISIBLE_SIZE_PX = 2;

/**
 * Has a box a person could see: not collapsed to nothing, and not parked off the top or left
 * of the page, where scrolling never reaches.
 */
export const hasLayoutBox: BoxProbe = (element) => {
  const rect = element.getBoundingClientRect();
  if (rect.width < MIN_VISIBLE_SIZE_PX || rect.height < MIN_VISIBLE_SIZE_PX) return false;
  return rect.right + window.scrollX > 0 && rect.bottom + window.scrollY > 0;
};

/** Hidden by itself or by any ancestor: removed from layout, marked hidden, or fully transparent. */
function isHiddenByAncestry(element: Element): boolean {
  for (let node: Element | null = element; node; node = parentAcrossShadow(node)) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true;
    if (node.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(node);
    if (style.display === 'none' || Number.parseFloat(style.opacity) === 0) return true;
  }
  return false;
}

function hasHiddenVisibility(element: Element): boolean {
  for (let node: Element | null = element; node; node = parentAcrossShadow(node)) {
    const { visibility } = getComputedStyle(node);
    if (visibility === 'visible') return false;
    if (visibility === 'hidden' || visibility === 'collapse') return true;
  }
  return false;
}

/**
 * Whether a person looking at the page can see the element. The extension only fills what the
 * user can see: a field hidden from view could collect data without the user ever knowing.
 */
export function isVisible(element: Element, hasBox: BoxProbe = hasLayoutBox): boolean {
  return !isHiddenByAncestry(element) && !hasHiddenVisibility(element) && hasBox(element);
}
