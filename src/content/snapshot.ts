import type { FrameSnapshot } from '../shared/types';
import { queryAllDeep } from './dom';
import { extractFields, type ExtractedField, type ExtractOptions } from './extractor';
import { hasLayoutBox, isVisible } from './extractor/visibility';
import { findButtons } from './navigator/buttons';
import { findStepTitle, looksLikeFinalStep } from './navigator/step-id';
import { findRepeatables } from './repeater';

/** A frame's description plus the live elements its fields and buttons refer to. */
export interface PageCapture {
  snapshot: FrameSnapshot;
  fields: Map<string, ExtractedField>;
  buttons: Map<string, HTMLElement>;
}

function visibleIframeOrigins(root: Document, options: ExtractOptions): string[] {
  const origins = new Set<string>();
  for (const iframe of queryAllDeep<HTMLIFrameElement>(root, 'iframe[src]')) {
    if (!isVisible(iframe, options.hasBox ?? hasLayoutBox)) continue;
    try {
      const { origin, protocol } = new URL(iframe.src, location.href);
      if (/^https?:$/.test(protocol) && origin !== location.origin) origins.add(origin);
    } catch {
      // Not a URL the extension could ever be granted access to.
    }
  }
  return [...origins];
}

/** Reads everything the service worker needs to know about this frame. */
export async function capturePage(
  root: Document,
  options: ExtractOptions = {},
): Promise<PageCapture> {
  const extracted = await extractFields(root, options);
  const buttons = findButtons(root, options);
  const title = findStepTitle(root, options.hasBox) ?? root.title;
  return {
    fields: new Map(extracted.map((field) => [field.schema.id, field])),
    buttons: new Map(buttons.map(({ info, element }) => [info.selector, element])),
    snapshot: {
      origin: location.origin,
      url: location.href,
      ...(title ? { title } : {}),
      fields: extracted.map((field) => field.schema),
      buttons: buttons.map(({ info }) => info),
      repeatables: findRepeatables(buttons, options.hasBox),
      iframeOrigins: visibleIframeOrigins(root, options),
      looksFinal: looksLikeFinalStep(root, options.hasBox),
    },
  };
}
