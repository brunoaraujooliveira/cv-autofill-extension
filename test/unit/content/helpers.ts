import {
  extractFields,
  type ExtractedField,
  type ExtractOptions,
} from '../../../src/content/extractor';

/** The test DOM has no layout engine, so every element is treated as occupying space. */
export const ALWAYS_HAS_BOX = () => true;

export function render(html: string): void {
  document.body.innerHTML = html;
}

export function extract(options: ExtractOptions = {}): Promise<ExtractedField[]> {
  return extractFields(document, { hasBox: ALWAYS_HAS_BOX, ...options });
}

export function byLabel(fields: readonly ExtractedField[], label: string): ExtractedField {
  const field = fields.find((candidate) => candidate.schema.label === label);
  if (!field) throw new Error(`No field labelled "${label}"`);
  return field;
}

/** Records the type of every event the element receives, in order. */
export function recordEvents(element: Element, types: readonly string[]): string[] {
  const seen: string[] = [];
  for (const type of types) {
    element.addEventListener(type, (event) => {
      seen.push(`${event.type}${event.bubbles ? '' : ' (no bubble)'}`);
    });
  }
  return seen;
}
