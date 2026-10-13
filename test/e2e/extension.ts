import {
  test as base,
  chromium,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import exampleResume from '../../examples/resume.example.json' with { type: 'json' };

/** The e2e build: same code, pointed at the local stand-in for the LLM provider. */
const EXTENSION_PATH = fileURLToPath(new URL('../../dist-e2e', import.meta.url));

export const OPTIONS_PAGE = 'src/options/index.html';
export const SIDE_PANEL_PAGE = 'src/sidepanel/index.html';

export interface OpenedFixture {
  form: Page;
  panel: Page;
}

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  /** API key of this test; the stand-in LLM files what it receives under it. */
  apiKey: string;
  openExtensionPage: (path: string) => Promise<Page>;
  /** Sends a request to the service worker, as the extension's own pages do. */
  sendToWorker: (type: string, payload?: unknown) => Promise<unknown>;
  /** Opens a page plus a side panel bound to it. `path` defaults to the fixture's own page. */
  openFixture: (name: string, path?: string) => Promise<OpenedFixture>;
}

/** Runs each test in a fresh Chromium profile with the extension loaded and a profile stored. */
export const test = base.extend<ExtensionFixtures>({
  // Playwright requires the first argument to be an object destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },

  // eslint-disable-next-line no-empty-pattern
  apiKey: async ({}, use) => {
    await use(`test-key-${randomUUID()}`);
  },

  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    });
  },

  sendToWorker: async ({ openExtensionPage }, use) => {
    let page: Page | undefined;
    await use(async (type, payload) => {
      page ??= await openExtensionPage(OPTIONS_PAGE);
      const reply = await page.evaluate(
        (message) => chrome.runtime.sendMessage<unknown, { ok: boolean; data?: unknown }>(message),
        { type, payload },
      );
      if (!reply.ok) throw new Error(`Request ${type} failed: ${JSON.stringify(reply)}`);
      return reply.data;
    });
  },

  openFixture: async ({ context, openExtensionPage, sendToWorker, apiKey, baseURL }, use) => {
    await use(async (name, path = `/fixtures/${name}/`) => {
      await sendToWorker('settings/save', { apiKey, fillDelayMs: 0 });
      await sendToWorker('resume/save', exampleResume);

      const form = await context.newPage();
      await form.goto(`${baseURL ?? ''}${path}`);
      const [worker] = context.serviceWorkers();
      const tabId = await worker?.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((tab) => tab.url === url)?.id;
      }, form.url());
      if (tabId === undefined) throw new Error(`No tab found for ${form.url()}`);

      const panel = await openExtensionPage(`${SIDE_PANEL_PAGE}?tabId=${tabId}`);
      return { form, panel };
    });
  },
});

export const expect = test.expect;

const REVIEW_PHASES = '[data-phase="WAITING_USER_REVIEW"], [data-phase="FINAL_REVIEW"]';

/** Waits until the run stops for the user: a step to review, or the final review. */
export async function waitForReview(panel: Page, stepNumber?: number): Promise<void> {
  if (stepNumber !== undefined) {
    await expect(panel.locator('.step-title')).toContainText(`Step ${stepNumber}`, {
      timeout: 20_000,
    });
  }
  await expect(panel.locator(REVIEW_PHASES)).toBeVisible({ timeout: 20_000 });
}

/** Starts a run from the side panel and waits until it stops for the user's review. */
export async function fillFromPanel(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Fill this page' }).click();
  await waitForReview(panel);
}

export function fieldRow(panel: Page, label: string) {
  return panel.locator('.field-row', { has: panel.getByText(label, { exact: false }) }).first();
}

interface SentField {
  label: string;
  type: string;
  options?: string[];
  [key: string]: unknown;
}

export interface SentRequest {
  /** The user message exactly as it left the browser. */
  raw: string;
  fields: SentField[];
}

/** Requests the stand-in LLM received from this test's API key, in order. */
export async function sentRequests(
  request: APIRequestContext,
  apiKey: string,
): Promise<SentRequest[]> {
  const recorded = (await (await request.get(`/mock/requests?key=${apiKey}`)).json()) as {
    messages: { content: string }[];
  }[];
  return recorded.map(({ messages }) => {
    const raw = messages[0]?.content ?? '{}';
    return { raw, fields: (JSON.parse(raw) as { fields?: SentField[] }).fields ?? [] };
  });
}
