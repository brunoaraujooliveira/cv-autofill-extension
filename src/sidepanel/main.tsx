import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MessageKey } from '../shared/i18n';
import { request } from '../ui/api';
import { AppProvider, useApp } from '../ui/app-context';
import '../ui/base.css';
import { RunView } from './components/RunView';
import './sidepanel.css';
import { useActiveTabId } from './use-active-tab';
import { useRun } from './use-run';

function useHasResume(): boolean | null {
  const [hasResume, setHasResume] = useState<boolean | null>(null);

  useEffect(() => {
    const refresh = () => {
      request('resume/get', undefined)
        .then((resume) => {
          setHasResume(resume !== null);
        })
        .catch(() => {
          setHasResume(false);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return hasResume;
}

function SidePanel() {
  const { settings, t } = useApp();
  const hasResume = useHasResume();
  const tabId = useActiveTabId();
  const controller = useRun(tabId);

  const missing: MessageKey[] = [];
  if (!settings.hasApiKey) missing.push('sidepanel.setup.apiKey');
  if (hasResume === false) missing.push('sidepanel.setup.resume');
  if (tabId === null) missing.push('run.noTab');

  return (
    <main class="sidepanel">
      <h1>{t('app.name')}</h1>
      {missing.length > 0 && (
        <section class="card">
          <ul class="setup">
            {missing.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>
      )}
      <RunView controller={controller} canStart={missing.length === 0 && hasResume === true} />
      <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
        {t('sidepanel.openOptions')}
      </button>
    </main>
  );
}

const root = document.getElementById('app');
if (root) {
  render(
    <AppProvider>
      <SidePanel />
    </AppProvider>,
    root,
  );
}
