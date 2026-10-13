import { createLogger } from '../shared/logger';
import { isRequest, type Notification } from '../shared/messages';
import { HttpLlmClient } from './llm/client';
import { Mapper } from './llm/mapper';
import { PROVIDER_ENDPOINT } from './llm/provider-config';
import { Orchestrator } from './orchestrator';
import { Router } from './router';
import { AnswerBank } from './storage/answer-bank';
import { ChromeLocalStore } from './storage/key-value-store';
import { MappingCache } from './storage/mapping-cache';
import { ResumeRepository } from './storage/resume';
import { ResumeFileRepository } from './storage/resume-file';
import { SettingsRepository } from './storage/settings';
import { StateStore } from './storage/state-store';
import { ChromeTabGateway } from './chrome-tab-gateway';

const logger = createLogger('background');
const store = new ChromeLocalStore();
const settings = new SettingsRepository(store);
const resume = new ResumeRepository(store);
const resumeFile = new ResumeFileRepository(store);
const answers = new AnswerBank(store);
const cache = new MappingCache(store);
const states = new StateStore(store);

function notify(notification: Notification): void {
  // Rejects when no extension page is open to receive it, which is expected.
  chrome.runtime.sendMessage(notification).catch(() => undefined);
}

function logFailure(what: string) {
  return (error: unknown) => {
    logger.error(what, error);
  };
}

// Test builds point the client at a local stand-in for the provider.
const endpoint = (import.meta.env.VITE_LLM_ENDPOINT as string | undefined) ?? PROVIDER_ENDPOINT;

const orchestrator = new Orchestrator({
  settings,
  resume,
  resumeFile,
  answers,
  cache,
  states,
  mapper: new Mapper(new HttpLlmClient({ endpoint })),
  tabs: new ChromeTabGateway(),
  logger,
  onChange: (state) => {
    notify({ type: 'run/changed', state });
  },
});

const router = new Router({
  settings,
  resume,
  resumeFile,
  answers,
  cache,
  orchestrator,
  onSettingsChanged: (view) => {
    notify({ type: 'settings/changed', settings: view });
  },
});

// Opening the panel from the click handler (instead of letting Chrome do it) is what grants
// `activeTab` for the tab the user is on, which the run needs to read and fill the page.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(logFailure('Could not configure the side panel'));

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .catch(logFailure('Could not open the side panel'));
});

// Keyboard shortcuts act on the tab in focus; like the icon, they grant access to it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (command === 'fill-page') {
    orchestrator.start(tab.id).catch(logFailure('Could not start the run'));
  } else if (command === 'next-step') {
    orchestrator.confirm(tab.id).catch(logFailure('Could not advance the run'));
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') {
    orchestrator.onTabReloaded(tabId).catch(logFailure('Could not flag the reloaded tab'));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  orchestrator.onTabClosed(tabId).catch(logFailure('Could not release the closed tab'));
});

// Tab ids start over when the browser does; stored runs are then found by their address.
chrome.runtime.onStartup.addListener(() => {
  states.detachTabs().catch(logFailure('Could not detach stored runs'));
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message)) return false;
  void router.handle(message).then(sendResponse);
  return true;
});
