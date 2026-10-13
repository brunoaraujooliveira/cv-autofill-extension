import { describe, expect, it } from 'vitest';
import {
  findOptionIndex,
  hashText,
  isFormatHint,
  normalizeForMatch,
} from '../../../src/shared/text';

describe('normalizeForMatch', () => {
  it('ignores case, accents, punctuation and extra spaces', () => {
    expect(normalizeForMatch('  São  Tomé & Príncipe ')).toBe('sao tome principe');
    expect(normalizeForMatch('C1 — Advanced')).toBe('c1 advanced');
  });
});

describe('findOptionIndex', () => {
  const options = ['Portugal', 'Brasil', 'portugal (mainland)'];

  it('prefers the exact option', () => {
    expect(findOptionIndex(options, 'Portugal')).toBe(0);
    expect(findOptionIndex(['a', 'A'], 'A')).toBe(1);
  });

  it('falls back to a normalized comparison', () => {
    expect(findOptionIndex(options, 'BRASIL')).toBe(1);
  });

  it('does not match partial or empty text', () => {
    expect(findOptionIndex(options, 'Port')).toBe(-1);
    expect(findOptionIndex(options, '  ')).toBe(-1);
  });
});

describe('hashText', () => {
  it('is deterministic and sensitive to the input', () => {
    expect(hashText('Name')).toBe(hashText('Name'));
    expect(hashText('Name')).not.toBe(hashText('Email'));
    expect(hashText('')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('isFormatHint', () => {
  it.each([
    'dd-mm-aaaa',
    'DD/MM/YYYY',
    'mm/yyyy',
    'jj.mm.aaaa',
    'hh:mm',
    '+351 000 000 000',
    '0000-000',
  ])('recognizes "%s" as showing a format', (text) => {
    expect(isFormatHint(text)).toBe(true);
  });

  it.each(['Data de Início', 'Day', 'May', 'City', 'Address line 2', 'Título ou Qualificação', ''])(
    'takes "%s" for a name',
    (text) => {
      expect(isFormatHint(text)).toBe(false);
    },
  );
});
