import type { AnswerEntry, CacheSummary, FileMeta } from './answers';
import type { Resume } from './resume';
import type { SettingsPatch, SettingsView } from './settings';
import type {
  AdvanceOutcome,
  FieldDecision,
  FillResult,
  FrameSnapshot,
  RunState,
  UploadFile,
} from './types';

type AnswerValue = NonNullable<FieldDecision['value']>;

/** Requests the UI pages send to the service worker, with their reply types. */
export interface RequestMap {
  'settings/get': { payload: undefined; reply: SettingsView };
  'settings/save': { payload: SettingsPatch; reply: SettingsView };
  'resume/get': { payload: undefined; reply: Resume | null };
  'resume/save': { payload: unknown; reply: Resume };
  'file/get': { payload: undefined; reply: FileMeta | null };
  'file/save': { payload: UploadFile; reply: FileMeta };
  'file/remove': { payload: undefined; reply: null };
  'answers/list': { payload: undefined; reply: AnswerEntry[] };
  'answers/save': { payload: { id: string; answer: string }; reply: AnswerEntry[] };
  'answers/remove': { payload: { id: string }; reply: AnswerEntry[] };
  'cache/list': { payload: undefined; reply: CacheSummary[] };
  'cache/clear': { payload: { domain: string }; reply: CacheSummary[] };
  'run/get': { payload: { tabId: number }; reply: RunState | null };
  /**
   * Reads and fills the step on screen. `redo` does that step over from nothing; `fresh`
   * discards everything decided in the whole application.
   */
  'run/start': {
    payload: { tabId: number; jobDescription?: string; fresh?: boolean; redo?: boolean };
    reply: RunState;
  };
  /** The user reviewed the step: move to the next one. */
  'run/confirm': { payload: { tabId: number }; reply: RunState };
  'run/answer': {
    payload: { tabId: number; fieldId: string; value: AnswerValue };
    reply: RunState;
  };
  'run/finish': { payload: { tabId: number }; reply: RunState };
}

export type RequestType = keyof RequestMap;

export type Request = {
  [T in RequestType]: { type: T; payload: RequestMap[T]['payload'] };
}[RequestType];

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Broadcast by the service worker when something the UI shows has changed. */
export type Notification =
  { type: 'settings/changed'; settings: SettingsView } | { type: 'run/changed'; state: RunState };

/** Requests the service worker sends to the content script of a frame. */
export interface ContentRequestMap {
  'content/extract': { payload: { frameId: number; settle: boolean }; reply: FrameSnapshot };
  'content/fill': {
    payload: { decisions: FieldDecision[]; delayMs: number; file?: UploadFile };
    reply: FillResult[];
  };
  'content/advance': { payload: { selector: string }; reply: AdvanceOutcome };
  'content/add-block': { payload: { selector: string }; reply: boolean };
}

export type ContentRequestType = keyof ContentRequestMap;

export type ContentRequest = {
  [T in ContentRequestType]: { type: T; payload: ContentRequestMap[T]['payload'] };
}[ContentRequestType];

const REQUEST_TYPES: readonly string[] = [
  'settings/get',
  'settings/save',
  'resume/get',
  'resume/save',
  'file/get',
  'file/save',
  'file/remove',
  'answers/list',
  'answers/save',
  'answers/remove',
  'cache/list',
  'cache/clear',
  'run/get',
  'run/start',
  'run/confirm',
  'run/answer',
  'run/finish',
] satisfies RequestType[];

const NOTIFICATION_TYPES: readonly string[] = [
  'settings/changed',
  'run/changed',
] satisfies Notification['type'][];

const CONTENT_REQUEST_TYPES: readonly string[] = [
  'content/extract',
  'content/fill',
  'content/advance',
  'content/add-block',
] satisfies ContentRequestType[];

function hasTypeIn(message: unknown, types: readonly string[]): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string' &&
    types.includes(message.type)
  );
}

export function isRequest(message: unknown): message is Request {
  return hasTypeIn(message, REQUEST_TYPES);
}

export function isNotification(message: unknown): message is Notification {
  return hasTypeIn(message, NOTIFICATION_TYPES);
}

export function isContentRequest(message: unknown): message is ContentRequest {
  return hasTypeIn(message, CONTENT_REQUEST_TYPES);
}
