import { useState } from 'preact/hooks';
import {
  LOCALE_PREFERENCES,
  MAX_FILL_DELAY_MS,
  type LocalePreference,
  type SettingsPatch,
} from '../../shared/settings';
import { request } from '../../ui/api';
import { useApp } from '../../ui/app-context';
import { errorDetail, StatusLine, type Status } from './StatusLine';

const LANGUAGE_NAMES: Record<Exclude<LocalePreference, 'auto'>, string> = {
  pt: 'Português',
  en: 'English',
};

export function SettingsForm() {
  const { settings, t } = useApp();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(settings.model);
  const [locale, setLocale] = useState(settings.locale);
  const [fillDelayMs, setFillDelayMs] = useState(settings.fillDelayMs);
  const [autoAdvance, setAutoAdvance] = useState(settings.autoAdvance);
  const [status, setStatus] = useState<Status>(null);

  const save = async (patch: SettingsPatch) => {
    try {
      await request('settings/save', patch);
      setApiKey('');
      setStatus({ kind: 'ok', text: t('options.saved') });
    } catch (error) {
      setStatus({ kind: 'error', text: t('options.error', { detail: errorDetail(error) }) });
    }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const typedKey = apiKey.trim();
    void save({
      model,
      locale,
      fillDelayMs,
      autoAdvance,
      ...(typedKey ? { apiKey: typedKey } : {}),
    });
  };

  return (
    <form class="card" onSubmit={submit}>
      <h2>{t('settings.heading')}</h2>

      <label class="field">
        {t('settings.apiKey')}
        <input
          type="password"
          autocomplete="off"
          value={apiKey}
          onInput={(event) => {
            setApiKey(event.currentTarget.value);
          }}
        />
      </label>
      <p class="hint">
        {t(settings.hasApiKey ? 'settings.apiKey.stored' : 'settings.apiKey.missing')}
      </p>

      <label class="field">
        {t('settings.model')}
        <input
          type="text"
          required
          value={model}
          onInput={(event) => {
            setModel(event.currentTarget.value);
          }}
        />
      </label>

      <h2>{t('settings.behavior')}</h2>

      <label class="field">
        {t('settings.language')}
        <select
          value={locale}
          onChange={(event) => {
            setLocale(event.currentTarget.value as LocalePreference);
          }}
        >
          {LOCALE_PREFERENCES.map((option) => (
            <option key={option} value={option}>
              {option === 'auto' ? t('settings.language.auto') : LANGUAGE_NAMES[option]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        {t('settings.fillDelay')}
        <input
          type="number"
          min={0}
          max={MAX_FILL_DELAY_MS}
          step={10}
          value={fillDelayMs}
          onInput={(event) => {
            setFillDelayMs(event.currentTarget.valueAsNumber || 0);
          }}
        />
      </label>

      <label class="field field--inline">
        <input
          type="checkbox"
          checked={autoAdvance}
          onChange={(event) => {
            setAutoAdvance(event.currentTarget.checked);
          }}
        />
        {t('settings.autoAdvance')}
      </label>

      <div class="actions">
        <button type="submit" class="primary">
          {t('settings.save')}
        </button>
        {settings.hasApiKey && (
          <button type="button" onClick={() => void save({ apiKey: '' })}>
            {t('settings.apiKey.remove')}
          </button>
        )}
        <StatusLine status={status} />
      </div>
    </form>
  );
}
