import { hashText } from '../../shared/text';
import type { FieldGroup } from '../../shared/types';
import { fromAriaLabel, fromAriaLabelledBy, textWithoutControls } from './label';

const GROUP_CONTAINERS = 'fieldset, [role="group"], [role="radiogroup"], section, [data-section]';
const HEADINGS = ':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5';

export function groupContainerLabel(container: Element): string {
  const heading = container.querySelector(HEADINGS);
  if (heading) return textWithoutControls(heading).replace(/\*/g, '').trim();
  return (fromAriaLabelledBy(container) ?? fromAriaLabel(container))?.text ?? '';
}

/**
 * Assigns each field to its enclosing labelled section. Sections whose labels differ only by a
 * number ("Experience 1", "Experience 2") share a base and get consecutive indexes.
 */
export class GroupResolver {
  private readonly groups = new Map<Element, FieldGroup>();
  private readonly countsByBase = new Map<string, number>();

  /** `start` is where the search begins; pass the parent to skip a container already used as label. */
  resolve(start: Element | null): FieldGroup | undefined {
    for (
      let container = start?.closest(GROUP_CONTAINERS);
      container;
      container = container.parentElement?.closest(GROUP_CONTAINERS)
    ) {
      const known = this.groups.get(container);
      if (known) return known;
      const label = groupContainerLabel(container);
      if (label !== '') return this.register(container, label);
    }
    return undefined;
  }

  private register(container: Element, label: string): FieldGroup {
    const base = label.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const index = this.countsByBase.get(base) ?? 0;
    this.countsByBase.set(base, index + 1);
    const group = { key: `g${hashText(base)}-${index}`, label, index };
    this.groups.set(container, group);
    return group;
  }
}
