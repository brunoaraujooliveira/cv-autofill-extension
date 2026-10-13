export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitOptions {
  root?: Node;
  timeoutMs?: number;
}

const OBSERVE_EVERYTHING: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
};

/**
 * Resolves with the first truthy value `probe` returns, re-evaluating on every DOM mutation.
 * The timeout is only a safety limit; it resolves with null when it is reached.
 */
export function waitFor<T>(
  probe: () => T | null | undefined | false,
  { root = document, timeoutMs = 3000 }: WaitOptions = {},
): Promise<T | null> {
  const immediate = probe();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const finish = (value: T | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const value = probe();
      if (value) finish(value);
    });
    const timer = setTimeout(() => {
      finish(null);
    }, timeoutMs);
    observer.observe(root, OBSERVE_EVERYTHING);
  });
}

/**
 * Resolves once the DOM has stopped changing for `quietMs`, or after `timeoutMs` at most.
 * Gives validations that run after a field loses focus time to show their messages.
 */
export function waitForQuiet({ quietMs = 120, timeoutMs = 1500 } = {}): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(limitTimer);
      resolve();
    };
    let quietTimer = setTimeout(finish, quietMs);
    const limitTimer = setTimeout(finish, timeoutMs);
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    observer.observe(document, OBSERVE_EVERYTHING);
  });
}

/** Parent in the flattened tree: crosses from a shadow root to its host. */
export function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Like querySelectorAll, but also looks inside open shadow roots, in document order. */
export function queryAllDeep<T extends Element>(root: ParentNode, selector: string): T[] {
  const found: T[] = [];
  const visit = (scope: ParentNode) => {
    for (const element of Array.from(scope.querySelectorAll('*'))) {
      if (element.matches(selector)) found.push(element as T);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(root);
  return found;
}

export function cssEscape(value: string): string {
  return CSS.escape(value);
}

export function pressKey(target: Element, key: string): void {
  const init = { key, code: key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** Full pointer sequence: some widgets open on mousedown, others on click. */
export function clickLikeUser(target: HTMLElement): void {
  const init = { bubbles: true, cancelable: true, view: window };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.click();
}
