import {
  settingsPatchSchema,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '../../shared/settings';
import { PROVIDER_CONFIG } from '../llm/provider-config';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: PROVIDER_CONFIG.defaultModel,
  locale: 'auto',
  fillDelayMs: 150,
  autoAdvance: false,
};

export class SettingsRepository {
  constructor(private readonly store: KeyValueStore) {}

  /** Stored values win over defaults; anything unreadable falls back to the defaults. */
  async load(): Promise<Settings> {
    const stored = await this.store.get(STORAGE_KEY);
    const candidate = { ...DEFAULT_SETTINGS, ...(isRecord(stored) ? stored : {}) };
    const parsed = settingsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async save(patch: SettingsPatch): Promise<Settings> {
    const validPatch = settingsPatchSchema.parse(patch);
    const next = settingsSchema.parse({ ...(await this.load()), ...validPatch });
    await this.store.set(STORAGE_KEY, next);
    return next;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
