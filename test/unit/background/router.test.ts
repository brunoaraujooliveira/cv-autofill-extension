import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Orchestrator } from '../../../src/background/orchestrator';
import { Router } from '../../../src/background/router';
import { AnswerBank } from '../../../src/background/storage/answer-bank';
import { InMemoryStore } from '../../../src/background/storage/key-value-store';
import { MappingCache } from '../../../src/background/storage/mapping-cache';
import { ResumeRepository } from '../../../src/background/storage/resume';
import { ResumeFileRepository } from '../../../src/background/storage/resume-file';
import { SettingsRepository } from '../../../src/background/storage/settings';
import { isContentRequest, isNotification, isRequest } from '../../../src/shared/messages';
import type { SettingsView } from '../../../src/shared/settings';
import type { RunState } from '../../../src/shared/types';

const runState = (tabId: number): RunState => ({
  tabId,
  key: 'jobs.example.com/apply',
  phase: 'EXTRACTING',
  stepNumber: 1,
  decisions: [],
  results: [],
  decided: {},
  attempts: {},
  added: {},
  updatedAt: 0,
});

const PDF = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };

describe('Router', () => {
  const onSettingsChanged = vi.fn<(settings: SettingsView) => void>();
  const orchestrator = {
    get: vi.fn<Orchestrator['get']>(),
    start: vi.fn<Orchestrator['start']>(),
    confirm: vi.fn<Orchestrator['confirm']>(),
    answer: vi.fn<Orchestrator['answer']>(),
    finish: vi.fn<Orchestrator['finish']>(),
  };
  let answers: AnswerBank;
  let router: Router;

  beforeEach(() => {
    vi.resetAllMocks();
    const store = new InMemoryStore();
    answers = new AnswerBank(store);
    router = new Router({
      settings: new SettingsRepository(store),
      resume: new ResumeRepository(store),
      resumeFile: new ResumeFileRepository(store),
      answers,
      cache: new MappingCache(store),
      orchestrator,
      onSettingsChanged,
    });
  });

  it('never exposes the API key, only whether one is stored', async () => {
    const before = await router.handle({ type: 'settings/get', payload: undefined });
    expect(before).toMatchObject({ ok: true, data: { hasApiKey: false } });

    const after = await router.handle({ type: 'settings/save', payload: { apiKey: 'key-1' } });
    expect(after).toMatchObject({ ok: true, data: { hasApiKey: true } });
    expect(JSON.stringify(after)).not.toContain('key-1');
  });

  it('announces saved settings', async () => {
    await router.handle({ type: 'settings/save', payload: { locale: 'pt' } });
    expect(onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pt' }));
  });

  it('stores and returns the resume', async () => {
    const resume = { basics: { name: 'Ana', email: 'ana@example.com' } };
    await router.handle({ type: 'resume/save', payload: resume });
    expect(await router.handle({ type: 'resume/get', payload: undefined })).toEqual({
      ok: true,
      data: resume,
    });
  });

  it('stores the resume file and only ever returns its description', async () => {
    const meta = { name: 'resume.pdf', type: 'application/pdf', size: 13 };
    expect(await router.handle({ type: 'file/get', payload: undefined })).toEqual({
      ok: true,
      data: null,
    });
    expect(await router.handle({ type: 'file/save', payload: PDF })).toEqual({
      ok: true,
      data: meta,
    });
    expect(await router.handle({ type: 'file/get', payload: undefined })).toEqual({
      ok: true,
      data: meta,
    });
    await router.handle({ type: 'file/remove', payload: undefined });
    expect(await router.handle({ type: 'file/get', payload: undefined })).toEqual({
      ok: true,
      data: null,
    });
  });

  it('lists, edits and removes stored answers', async () => {
    const { id } = await answers.remember('Notice period', '30 days');
    const edited = await router.handle({
      type: 'answers/save',
      payload: { id, answer: '60 days' },
    });
    expect(edited).toMatchObject({ ok: true, data: [{ id, answer: '60 days' }] });
    expect(await router.handle({ type: 'answers/list', payload: undefined })).toEqual(edited);
    expect(await router.handle({ type: 'answers/remove', payload: { id } })).toEqual({
      ok: true,
      data: [],
    });
  });

  it('lists and clears learnt mappings', async () => {
    expect(await router.handle({ type: 'cache/list', payload: undefined })).toEqual({
      ok: true,
      data: [],
    });
    expect(await router.handle({ type: 'cache/clear', payload: { domain: 'a.example' } })).toEqual({
      ok: true,
      data: [],
    });
  });

  it('hands run requests to the orchestrator', async () => {
    orchestrator.start.mockResolvedValue(runState(7));
    orchestrator.get.mockResolvedValue(null);

    const started = await router.handle({
      type: 'run/start',
      payload: { tabId: 7, jobDescription: 'Senior engineer', fresh: true },
    });
    expect(started).toEqual({ ok: true, data: runState(7) });
    expect(orchestrator.start).toHaveBeenCalledWith(7, {
      jobDescription: 'Senior engineer',
      fresh: true,
    });

    await router.handle({ type: 'run/get', payload: { tabId: 7 } });
    await router.handle({ type: 'run/confirm', payload: { tabId: 7 } });
    await router.handle({ type: 'run/answer', payload: { tabId: 7, fieldId: 'f1', value: 'x' } });
    await router.handle({ type: 'run/finish', payload: { tabId: 7 } });
    expect(orchestrator.get).toHaveBeenCalledWith(7);
    expect(orchestrator.confirm).toHaveBeenCalledWith(7);
    expect(orchestrator.answer).toHaveBeenCalledWith(7, 'f1', 'x');
    expect(orchestrator.finish).toHaveBeenCalledWith(7);
  });

  it('turns failures into error replies', async () => {
    orchestrator.confirm.mockRejectedValue(new Error('Not allowed now'));
    expect(await router.handle({ type: 'run/confirm', payload: { tabId: 7 } })).toEqual({
      ok: false,
      error: 'Not allowed now',
    });
    const invalid = await router.handle({ type: 'resume/save', payload: { basics: {} } });
    expect(invalid.ok).toBe(false);
  });
});

describe('message guards', () => {
  it('accept known request types only', () => {
    expect(isRequest({ type: 'settings/get' })).toBe(true);
    expect(isRequest({ type: 'run/confirm' })).toBe(true);
    expect(isRequest({ type: 'settings/changed' })).toBe(false);
    expect(isRequest({ type: 42 })).toBe(false);
    expect(isRequest('settings/get')).toBe(false);
    expect(isRequest(null)).toBe(false);
  });

  it('tell notifications and content requests apart', () => {
    expect(isNotification({ type: 'run/changed' })).toBe(true);
    expect(isNotification({ type: 'run/start' })).toBe(false);
    expect(isContentRequest({ type: 'content/advance' })).toBe(true);
    expect(isContentRequest({ type: 'run/start' })).toBe(false);
  });
});
