/** A control and what identifies the question it asks (its type and label). */
export interface BlockItem {
  element: Element;
  key: string;
}

function commonAncestor(elements: readonly Element[]): Element | null {
  let ancestor = elements[0]?.parentElement ?? null;
  while (ancestor && !elements.every((element) => ancestor?.contains(element))) {
    ancestor = ancestor.parentElement;
  }
  return ancestor;
}

function childHolding(ancestor: Element, element: Element): Element | null {
  let node: Element | null = element;
  while (node && node.parentElement !== ancestor) node = node.parentElement;
  return node;
}

/**
 * Finds the repeated blocks among a set of controls ("Company, Title" twice) from the page
 * structure: the question asked most often marks the blocks, and each block is the branch of
 * their common ancestor that holds one occurrence. Returns each control's block index, or null
 * when nothing repeats.
 */
export function splitIntoBlocks(items: readonly BlockItem[]): Map<Element, number> | null {
  const counts = new Map<string, number>();
  for (const { key } of items) counts.set(key, (counts.get(key) ?? 0) + 1);
  const [anchorKey, anchorCount] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (anchorCount < 2) return null;

  const anchors = items.filter((item) => item.key === anchorKey).map((item) => item.element);
  const ancestor = commonAncestor(anchors);
  if (!ancestor) return null;
  const branches = [...new Set(anchors.map((anchor) => childHolding(ancestor, anchor)))];
  if (branches.length < 2) return null;

  const blocks = new Map<Element, number>();
  for (const { element } of items) {
    const index = ancestor.contains(element)
      ? branches.indexOf(childHolding(ancestor, element))
      : -1;
    if (index !== -1) blocks.set(element, index);
  }
  return blocks;
}
