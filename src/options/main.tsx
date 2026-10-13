import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { AppProvider, useApp } from '../ui/app-context';
import '../ui/base.css';
import { AnswersSection } from './components/AnswersSection';
import { CacheSection } from './components/CacheSection';
import { ResumeEditor } from './components/ResumeEditor';
import { ResumeFileSection } from './components/ResumeFileSection';
import { SettingsForm } from './components/SettingsForm';
import './options.css';

/** Closes the tab the options live in; the page cannot rely on window.close() alone. */
function closeOptions(): void {
  chrome.tabs
    .getCurrent()
    .then((tab) => (tab?.id === undefined ? undefined : chrome.tabs.remove(tab.id)))
    .catch(() => undefined)
    .finally(() => {
      window.close();
    });
}

function OptionsPage() {
  const { t } = useApp();
  useEffect(() => {
    document.title = t('options.title');
  }, [t]);

  return (
    <main class="options">
      <header class="options__header">
        <h1>{t('options.title')}</h1>
        <button type="button" onClick={closeOptions}>
          {t('options.close')}
        </button>
      </header>
      <SettingsForm />
      <ResumeEditor />
      <ResumeFileSection />
      <AnswersSection />
      <CacheSection />
    </main>
  );
}

const root = document.getElementById('app');
if (root) {
  render(
    <AppProvider>
      <OptionsPage />
    </AppProvider>,
    root,
  );
}
