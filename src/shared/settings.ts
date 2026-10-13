import { z } from 'zod';

export const LOCALE_PREFERENCES = ['auto', 'pt', 'en'] as const;

export const MAX_FILL_DELAY_MS = 2000;

export const settingsSchema = z.object({
  apiKey: z.string(),
  model: z.string().trim().min(1),
  locale: z.enum(LOCALE_PREFERENCES),
  fillDelayMs: z.number().int().min(0).max(MAX_FILL_DELAY_MS),
  autoAdvance: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type LocalePreference = Settings['locale'];

/** What the UI is allowed to see: the key itself never leaves the service worker. */
export type SettingsView = Omit<Settings, 'apiKey'> & { hasApiKey: boolean };

export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function toSettingsView(settings: Settings): SettingsView {
  const { apiKey, ...visible } = settings;
  return { ...visible, hasApiKey: apiKey.length > 0 };
}
