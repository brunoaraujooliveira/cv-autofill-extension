import {
  isNotification,
  type Notification,
  type Reply,
  type RequestMap,
  type RequestType,
} from '../shared/messages';

export async function request<T extends RequestType>(
  type: T,
  payload: RequestMap[T]['payload'],
): Promise<RequestMap[T]['reply']> {
  const reply: Reply<RequestMap[T]['reply']> = await chrome.runtime.sendMessage({ type, payload });
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Subscribes to service worker broadcasts; returns the unsubscribe function. */
export function onNotification(listener: (notification: Notification) => void): () => void {
  const handler = (message: unknown) => {
    if (isNotification(message)) listener(message);
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => {
    chrome.runtime.onMessage.removeListener(handler);
  };
}
