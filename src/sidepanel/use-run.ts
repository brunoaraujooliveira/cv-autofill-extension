import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { RequestMap } from '../shared/messages';
import type { FieldValue, RunState } from '../shared/types';
import { onNotification, request } from '../ui/api';
import { errorMessage } from '../shared/text';

type RunRequest = 'run/start' | 'run/confirm' | 'run/answer' | 'run/finish';

export interface RunActions {
  start: (options?: { jobDescription?: string; fresh?: boolean; redo?: boolean }) => void;
  confirm: () => void;
  finish: () => void;
  /** Asks a working run to stop at its next checkpoint. */
  cancel: () => void;
  answer: (fieldId: string, value: FieldValue) => void;
}

export interface RunController extends RunActions {
  run: RunState | null;
  /** Message of the last action the service worker refused. */
  actionError: string | null;
}

/** Run state of a tab, kept in sync with the service worker, plus the actions on it. */
export function useRun(tabId: number | null): RunController {
  const [run, setRun] = useState<RunState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setRun(null);
    setActionError(null);
    if (tabId === null) return undefined;
    request('run/get', { tabId })
      .then(setRun)
      .catch(() => {
        setRun(null);
      });
    return onNotification((notification) => {
      if (notification.type === 'run/changed' && notification.state.tabId === tabId) {
        setRun(notification.state);
      }
    });
  }, [tabId]);

  const send = useCallback(
    <T extends RunRequest>(type: T, extra: Omit<RequestMap[T]['payload'], 'tabId'>) => {
      if (tabId === null) return;
      setActionError(null);
      request(type, { tabId, ...extra })
        .then(setRun)
        .catch((error: unknown) => {
          setActionError(errorMessage(error));
        });
    },
    [tabId],
  );

  const actions = useMemo<RunActions>(
    () => ({
      start: (options = {}) => {
        send('run/start', options);
      },
      confirm: () => {
        send('run/confirm', {});
      },
      finish: () => {
        send('run/finish', {});
      },
      cancel: () => {
        if (tabId === null) return;
        request('run/cancel', { tabId }).catch((error: unknown) => {
          setActionError(errorMessage(error));
        });
      },
      answer: (fieldId, value) => {
        send('run/answer', { fieldId, value });
      },
    }),
    [send, tabId],
  );

  return { run, actionError, ...actions };
}
