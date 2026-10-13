import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { createTranslator, resolveLocale, type Locale, type Translate } from '../shared/i18n';
import type { SettingsView } from '../shared/settings';
import { onNotification, request } from './api';
import { errorMessage } from '../shared/text';

interface AppContextValue {
  settings: SettingsView;
  locale: Locale;
  t: Translate;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Loads the settings once, keeps them in sync with the service worker and exposes the translator. */
export function AppProvider({ children }: { children: ComponentChildren }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    request('settings/get', undefined)
      .then(setSettings)
      .catch((error: unknown) => {
        setLoadError(errorMessage(error));
      });
    return onNotification((notification) => {
      if (notification.type === 'settings/changed') setSettings(notification.settings);
    });
  }, []);

  const value = useMemo(() => {
    if (!settings) return null;
    const locale = resolveLocale(settings.locale, navigator.language);
    return { settings, locale, t: createTranslator(locale) };
  }, [settings]);

  useEffect(() => {
    if (value) document.documentElement.lang = value.locale;
  }, [value]);

  if (loadError) return <p class="status status--error">{loadError}</p>;
  if (!value) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
