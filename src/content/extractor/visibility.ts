import { parentAcrossShadow } from '../dom';

/** Tells whether an element occupies space on screen. Injectable because test DOMs have no layout. */
export type BoxProbe = (element: Element) => boolean;

export const hasLayoutBox: BoxProbe = (element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

function isHiddenByAncestry(element: Element): boolean {
  for (let node: Element | null = element; node; node = parentAcrossShadow(node)) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true;
    if (node.getAttribute('aria-hidden') === 'true') return true;
    if (getComputedStyle(node).display === 'none') return true;
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

export function isVisible(element: Element, hasBox: BoxProbe = hasLayoutBox): boolean {
  return !isHiddenByAncestry(element) && !hasHiddenVisibility(element) && hasBox(element);
}
