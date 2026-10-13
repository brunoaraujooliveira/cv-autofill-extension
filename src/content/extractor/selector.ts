import { cssEscape } from '../dom';

type QueryRoot = Document | ShadowRoot;

/** Attributes sites add on purpose to identify elements; more stable than position. */
const STABLE_ATTRIBUTES = ['data-automation-id', 'data-testid', 'data-test', 'data-qa', 'name'];

function isUnique(root: QueryRoot, selector: string): boolean {
  return root.querySelectorAll(selector).length === 1;
}

function byId(element: Element, root: QueryRoot): string | null {
  if (!element.id) return null;
  const selector = `#${cssEscape(element.id)}`;
  return isUnique(root, selector) ? selector : null;
}

function byStableAttribute(element: Element, root: QueryRoot): string | null {
  const tag = element.tagName.toLowerCase();
  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = `${tag}[${attribute}="${cssEscape(value)}"]`;
    if (isUnique(root, selector)) return selector;
  }
  return null;
}

function positionalSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const sameTagSiblings = Array.from(element.parentElement?.children ?? []).filter(
    (sibling) => sibling.tagName === element.tagName,
  );
  if (sameTagSiblings.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
}

/**
 * Builds a selector that finds the element again inside its own document or shadow root:
 * id, then a stable attribute, then a positional path anchored on the nearest identifiable ancestor.
 */
export function buildSelector(element: Element): string {
  const root = element.getRootNode() as QueryRoot;
  const segments: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const anchor = byId(node, root) ?? byStableAttribute(node, root);
    if (anchor) return [anchor, ...segments].join(' > ');
    segments.unshift(positionalSegment(node));
  }
  return segments.join(' > ');
}

/** Separator between the selector of a shadow host and the selector inside its shadow root. */
export const SHADOW_SEPARATOR = ' >>> ';

/** Like buildSelector, but prefixed with the chain of shadow hosts the element lives under. */
export function buildDeepSelector(element: Element): string {
  const parts = [buildSelector(element)];
  for (
    let root = element.getRootNode();
    root instanceof ShadowRoot;
    root = root.host.getRootNode()
  ) {
    parts.unshift(buildSelector(root.host));
  }
  return parts.join(SHADOW_SEPARATOR);
}
