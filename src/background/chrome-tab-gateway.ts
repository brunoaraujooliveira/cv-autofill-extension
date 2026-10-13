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
import { errorMessage } from '../shared/text';

const NAVIGATION_TIMEOUT_MS = 15000;

/** The content script answered, and the answer was a failure: the page is still there. */
class ContentScriptError extends Error {}

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
  if (!reply.ok) throw new ContentScriptError(reply.error);
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
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish();
      })
      // The tab is gone; the timeout or the caller's next step will find out.
      .catch(finish);
  });
}

export class ChromeTabGateway implements TabGateway {
  /** Frames the content script was last injected into, per tab. */
  private readonly frames = new Map<number, number[]>();

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
    const uploadFields = new Set(
      step.fields.filter((field) => field.type === 'file').map((field) => field.id),
    );
    for (const [frameId, frameDecisions] of byFrame) {
      // The resume file only travels to a frame that is about to attach it.
      const needsFile = frameDecisions.some((decision) => uploadFields.has(decision.fieldId));
      const payload = {
        decisions: frameDecisions,
        delayMs,
        ...(file && needsFile ? { file } : {}),
      };
      results.push(...(await send(tabId, frameId, 'content/fill', payload)));
    }
    return results;
  }

  async advance(tabId: number, button: ButtonInfo): Promise<AdvanceOutcome> {
    try {
      return await send(tabId, button.frameId, 'content/advance', { selector: button.selector });
    } catch (error) {
      // A failure reported by the page is a failure. Only a lost connection means the click
      // loaded a new document and took the content script with it.
      if (error instanceof ContentScriptError) throw error;
      await waitForTabLoad(tabId);
      return 'advanced';
    }
  }

  addBlock(tabId: number, repeatable: RepeatableSection): Promise<boolean> {
    return send(tabId, repeatable.frameId, 'content/add-block', { selector: repeatable.selector });
  }

  async cancel(tabId: number): Promise<void> {
    const frameIds = this.frames.get(tabId) ?? [];
    await Promise.all(
      frameIds.map((frameId) =>
        send(tabId, frameId, 'content/cancel', undefined).catch(() => null),
      ),
    );
  }

  /** Injects the content script wherever access was granted and returns those frame ids. */
  private async inject(tabId: number): Promise<number[]> {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [contentScript],
      });
      const frameIds = injected.map((result) => result.frameId);
      this.frames.set(tabId, frameIds);
      return frameIds;
    } catch (error) {
      throw new InjectionError(errorMessage(error));
    }
  }
}

/**
 * Gives back every optional site permission. They are granted to read one embedded frame of
 * one form, so they are not kept once that application is finished or its tab is closed.
 */
export async function revokeOptionalSiteAccess(): Promise<void> {
  const declared: unknown = chrome.runtime.getManifest().host_permissions;
  const required = new Set<unknown>(Array.isArray(declared) ? declared : []);
  const { origins = [] } = await chrome.permissions.getAll();
  const optional = origins.filter((origin) => !required.has(origin));
  if (optional.length > 0) await chrome.permissions.remove({ origins: optional });
}

/**
 * Keeps the service worker awake while a run works: any extension API call resets the idle
 * timer that would otherwise stop it between two steps. Returns how to stop.
 */
export function keepServiceWorkerAwake(): () => void {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => {
    clearInterval(timer);
  };
}
