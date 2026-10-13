import type { Reply, Request, RequestMap, RequestType } from '../shared/messages';
import { toSettingsView, type SettingsView } from '../shared/settings';
import type { Orchestrator } from './orchestrator';
import type { AnswerBank } from './storage/answer-bank';
import type { MappingCache } from './storage/mapping-cache';
import { toFileMeta, type ResumeFileRepository } from './storage/resume-file';
import type { ResumeRepository } from './storage/resume';
import type { SettingsRepository } from './storage/settings';

export interface RouterDependencies {
  settings: SettingsRepository;
  resume: ResumeRepository;
  resumeFile: ResumeFileRepository;
  answers: AnswerBank;
  cache: MappingCache;
  orchestrator: Pick<Orchestrator, 'start' | 'get' | 'confirm' | 'answer' | 'finish'>;
  onSettingsChanged: (settings: SettingsView) => void;
}

type Handlers = {
  [T in RequestType]: (
    payload: RequestMap[T]['payload'],
  ) => Promise<RequestMap[T]['reply']> | RequestMap[T]['reply'];
};

/** Maps each request from the extension's pages to the code that serves it. */
export class Router {
  private readonly handlers: Handlers;

  constructor(dependencies: RouterDependencies) {
    const { settings, resume, resumeFile, answers, cache, orchestrator } = dependencies;
    this.handlers = {
      'settings/get': async () => toSettingsView(await settings.load()),
      'settings/save': async (patch) => {
        const view = toSettingsView(await settings.save(patch));
        dependencies.onSettingsChanged(view);
        return view;
      },
      'resume/get': () => resume.load(),
      'resume/save': (candidate) => resume.save(candidate),
      'file/get': async () => {
        const file = await resumeFile.load();
        return file ? toFileMeta(file) : null;
      },
      'file/save': (file) => resumeFile.save(file),
      'file/remove': async () => {
        await resumeFile.remove();
        return null;
      },
      'answers/list': () => answers.list(),
      'answers/save': ({ id, answer }) => answers.update(id, answer),
      'answers/remove': ({ id }) => answers.remove(id),
      'cache/list': () => cache.summary(),
      'cache/clear': async ({ domain }) => {
        await cache.clear(domain);
        return cache.summary();
      },
      'run/get': ({ tabId }) => orchestrator.get(tabId),
      'run/start': ({ tabId, ...options }) => orchestrator.start(tabId, options),
      'run/confirm': ({ tabId }) => orchestrator.confirm(tabId),
      'run/answer': ({ tabId, fieldId, value }) => orchestrator.answer(tabId, fieldId, value),
      'run/finish': ({ tabId }) => orchestrator.finish(tabId),
    };
  }

  async handle(request: Request): Promise<Reply<unknown>> {
    try {
      const handler = this.handlers[request.type] as (payload: unknown) => unknown;
      return { ok: true, data: await handler(request.payload) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
