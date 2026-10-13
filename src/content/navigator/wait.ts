const DEFAULT_TIMEOUT_MS = 15000;
/** A change has to hold this long to count, so half-rendered transitions are not mistaken for it. */
const SETTLE_MS = 150;

export interface StepMarker {
  url: string;
  signature: string;
}

export interface StepChangeOptions {
  timeoutMs?: number;
  settleMs?: number;
}

/**
 * Resolves true when the step changes: a different URL (including pushState navigation) or a
 * different set of fields. Driven by DOM mutations; the timeout is only a safety limit.
 */
export function waitForStepChange(
  before: StepMarker,
  readMarker: () => Promise<StepMarker>,
  { timeoutMs = DEFAULT_TIMEOUT_MS, settleMs = SETTLE_MS }: StepChangeOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;

    const finish = (changed: boolean) => {
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(limitTimer);
      resolve(changed);
    };
    const check = async () => {
      if (checking) return;
      checking = true;
      const now = await readMarker();
      checking = false;
      if (now.url !== before.url || now.signature !== before.signature) finish(true);
    };
    const schedule = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void check(), settleMs);
    };

    const observer = new MutationObserver(schedule);
    const limitTimer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    observer.observe(document, { subtree: true, childList: true, attributes: true });
    schedule();
  });
}
