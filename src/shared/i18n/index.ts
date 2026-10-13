import type { LocalePreference } from '../settings';
import { en, type MessageKey, type Messages } from './en';
import { pt } from './pt';

export type Locale = 'pt' | 'en';
export type { MessageKey };
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const DICTIONARIES: Record<Locale, Messages> = { en, pt };

export function resolveLocale(preference: LocalePreference, browserLanguage: string): Locale {
  if (preference !== 'auto') return preference;
  return browserLanguage.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function createTranslator(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, params = {}) =>
    dictionary[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in params ? String(params[name]) : placeholder,
    );
}
