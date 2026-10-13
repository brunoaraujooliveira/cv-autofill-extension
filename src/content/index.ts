import {
  isContentRequest,
  type ContentRequest,
  type ContentRequestMap,
  type Reply,
} from '../shared/messages';
import { stepSignature } from '../shared/step';
import { waitForQuiet } from './dom';
import { extractFields } from './extractor';
import { fillFields } from './filler';
import { harvestOptions } from './filler/combobox';
import { buttonText, classifyButtonText, isButtonDisabled } from './navigator/buttons';
import { findStepTitle } from './navigator/step-id';
import { waitForStepChange, type StepMarker } from './navigator/wait';
import { addBlock } from './repeater';
import { capturePage, type PageCapture } from './snapshot';

const INSTALLED_FLAG = '__cvAutofillContentScript';

type Handlers = {
  [T in keyof ContentRequestMap]: (
    payload: ContentRequestMap[T]['payload'],
  ) => Promise<ContentRequestMap[T]['reply']>;
};

/** Cheap fingerprint of the step on screen, to notice when it changes. */
async function readMarker(): Promise<StepMarker> {
  const fields = (await extractFields(document)).map((field) => field.schema);
  return { url: location.href, signature: stepSignature(fields, findStepTitle(document)) };
}

function createHandlers(): Handlers {
  /** Latest capture; decisions and clicks refer to its fields and buttons. */
  let capture: PageCapture | null = null;

  return {
    'content/extract': async ({ frameId, settle }) => {
      if (settle) await waitForQuiet();
      capture = await capturePage(document, { frameId, harvestOptions });
      return capture.snapshot;
    },

    'content/fill': ({ decisions, delayMs, file }) =>
      fillFields(capture?.fields ?? new Map(), decisions, { delayMs, ...(file ? { file } : {}) }),

    'content/advance': async ({ selector }) => {
      const button = capture?.buttons.get(selector);
      if (!button?.isConnected) return 'unchanged';
      // Checked again at click time: nothing that may submit is ever clicked.
      if (classifyButtonText(buttonText(button)) === 'submit') return 'refused';
      if (isButtonDisabled(button)) return 'disabled';
      const before = await readMarker();
      button.click();
      return (await waitForStepChange(before, readMarker)) ? 'advanced' : 'unchanged';
    },

    'content/add-block': async ({ selector }) => {
      const button = capture?.buttons.get(selector);
      return button?.isConnected ? addBlock(button) : false;
    },
  };
}

async function handle(handlers: Handlers, request: ContentRequest): Promise<Reply<unknown>> {
  try {
    const handler = handlers[request.type] as (payload: unknown) => Promise<unknown>;
    return { ok: true, data: await handler(request.payload) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// The script is injected on every activation; only the first injection installs the listener.
const scope = globalThis as Record<string, unknown>;
if (!scope[INSTALLED_FLAG]) {
  scope[INSTALLED_FLAG] = true;
  const handlers = createHandlers();
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return false;
    void handle(handlers, message).then(sendResponse);
    return true;
  });
}
