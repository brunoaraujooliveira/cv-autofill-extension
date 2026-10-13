export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Lowercases and drops accents and punctuation, so "São Paulo" matches "sao paulo". */
export function normalizeForMatch(text: string): string {
  return collapseWhitespace(
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  );
}

/** Index of the option equal to `wanted`: exact first, then ignoring case, accents and punctuation. */
export function findOptionIndex(options: readonly string[], wanted: string): number {
  const exact = options.indexOf(wanted);
  if (exact !== -1) return exact;
  const target = normalizeForMatch(wanted);
  if (target === '') return -1;
  return options.findIndex((option) => normalizeForMatch(option) === target);
}

/** FNV-1a, enough to derive short stable identifiers from labels and selectors. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Whether a text only shows the shape of a value ("dd-mm-aaaa", "+351 000 000 000") instead of
 * naming what is asked. Such a text cannot tell one field from another.
 */
export function isFormatHint(text: string): boolean {
  const letters = text.toLowerCase().replace(/[^a-z]/g, '');
  const onlyMaskLetters = /^[dmyajhsx]*$/.test(letters);
  const looksLikeMask = /\d/.test(text) || /(dd|mm|yy|aa|jj|hh|ss|xx)/i.test(text);
  return onlyMaskLetters && looksLikeMask;
}
