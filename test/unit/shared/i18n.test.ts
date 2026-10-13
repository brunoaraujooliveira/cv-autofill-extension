import { describe, expect, it } from 'vitest';
import { createTranslator, resolveLocale } from '../../../src/shared/i18n';
import { en } from '../../../src/shared/i18n/en';
import { pt } from '../../../src/shared/i18n/pt';

describe('resolveLocale', () => {
  it('honors an explicit preference', () => {
    expect(resolveLocale('pt', 'en-US')).toBe('pt');
    expect(resolveLocale('en', 'pt-BR')).toBe('en');
  });

  it.each([
    ['pt-BR', 'pt'],
    ['PT-pt', 'pt'],
    ['en-GB', 'en'],
    ['de-DE', 'en'],
  ] as const)('maps the browser language %s to %s', (browserLanguage, expected) => {
    expect(resolveLocale('auto', browserLanguage)).toBe(expected);
  });
});

describe('createTranslator', () => {
  it('translates per locale', () => {
    expect(createTranslator('en')('settings.model')).toBe('Model');
    expect(createTranslator('pt')('settings.model')).toBe('Modelo');
  });

  it('interpolates parameters and leaves unknown placeholders untouched', () => {
    const t = createTranslator('en');
    expect(t('options.error', { detail: 'disk full' })).toBe('Could not save: disk full');
    expect(t('options.error')).toBe('Could not save: {detail}');
  });
});

describe('dictionaries', () => {
  it('use the same placeholders in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(pt[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
