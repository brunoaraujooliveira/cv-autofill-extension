import contentScript from '../content/index.ts?iife';
import type { ContentRequestMap, ContentRequestType, Reply } from '../shared/messages';
import type {
  AdvanceOutcome,
  ButtonInfo,
  FieldDecision,
  FillResult,
  RepeatableSection,
  StepSchema,
  UploadFile,
} from '../shared/types';
import { mergeSnapshots, type CapturedFrame } from './step-merge';
import { InjectionError, type TabGateway } from './tab-gateway';

const NAVIGATION_TIMEOUT_MS = 15000;

async function send<T extends ContentRequestType>(
  tabId: number,
  frameId: number,
  type: T,
  payload: ContentRequestMap[T]['payload'],
): Promise<ContentRequestMap[T]['reply']> {
  const reply: Reply<ContentRequestMap[T]['reply']> | undefined = await chrome.tabs.sendMessage(
    tabId,
    { type, payload },
    { frameId },
  );
  if (!reply) throw new Error('The page did not answer');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Resolves when the tab finishes loading, or after a safety timeout. */
function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId: number, change: { status?: string }) => {
      if (updatedTabId === tabId && change.status === 'complete') finish();
    };
    const timer = setTimeout(finish, NAVIGATION_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    });
  });
}

export class ChromeTabGateway implements TabGateway {
  async url(tabId: number): Promise<string> {
    return (await chrome.tabs.get(tabId)).url ?? '';
  }

  async extract(tabId: number, settle: boolean): Promise<StepSchema> {
    const frameIds = await this.inject(tabId);
    const captured = await Promise.all(
      frameIds.map(async (frameId): Promise<CapturedFrame | null> => {
        try {
          const snapshot = await send(tabId, frameId, 'content/extract', { frameId, settle });
          return { frameId, snapshot };
        } catch {
          // A frame that went away while being read simply contributes nothing.
          return null;
        }
      }),
    );
    const frames = captured.filter((frame) => frame !== null);
    if (frames.length === 0) throw new InjectionError('No frame of the tab answered');
    return mergeSnapshots(frames);
  }

  async fill(
    tabId: number,
    step: StepSchema,
    decisions: readonly FieldDecision[],
    delayMs: number,
    file: UploadFile | null,
  ): Promise<FillResult[]> {
    const frameOf = new Map(step.fields.map((field) => [field.id, field.frameId]));
    const byFrame = new Map<number, FieldDecision[]>();
    for (const decision of decisions) {
      const frameId = frameOf.get(decision.fieldId) ?? 0;
      byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), decision]);
    }
    const results: FillResult[] = [];
    for (const [frameId, frameDecisions] of byFrame) {
      const payload = { decisions: frameDecisions, delayMs, ...(file ? { file } : {}) };
      results.push(...(await send(tabId, frameId, 'content/fill', payload)));
    }
    return results;
  }

  async advance(tabId: number, button: ButtonInfo): Promise<AdvanceOutcome> {
    try {
      return await send(tabId, button.frameId, 'content/advance', { selector: button.selector });
    } catch {
      // The click loaded a new document and took the content script with it.
      await waitForTabLoad(tabId);
      return 'advanced';
    }
  }

  addBlock(tabId: number, repeatable: RepeatableSection): Promise<boolean> {
    return send(tabId, repeatable.frameId, 'content/add-block', { selector: repeatable.selector });
  }

  /** Injects the content script wherever access was granted and returns those frame ids. */
  private async inject(tabId: number): Promise<number[]> {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [contentScript],
      });
      return injected.map((result) => result.frameId);
    } catch (error) {
      throw new InjectionError(error instanceof Error ? error.message : String(error));
    }
  }
}
