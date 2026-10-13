import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from '../../../src/background/llm/client';
import type { Mapper } from '../../../src/background/llm/mapper';
import { Orchestrator } from '../../../src/background/orchestrator';
import { AnswerBank } from '../../../src/background/storage/answer-bank';
import { InMemoryStore } from '../../../src/background/storage/key-value-store';
import { MappingCache } from '../../../src/background/storage/mapping-cache';
import { ResumeRepository } from '../../../src/background/storage/resume';
import { ResumeFileRepository } from '../../../src/background/storage/resume-file';
import { SettingsRepository } from '../../../src/background/storage/settings';
import { StateStore } from '../../../src/background/storage/state-store';
import { InjectionError, type TabGateway } from '../../../src/background/tab-gateway';
import { InvalidTransitionError } from '../../../src/shared/run-machine';
import { stepSignature } from '../../../src/shared/step';
import type {
  ButtonInfo,
  FieldDecision,
  FieldSchema,
  RunState,
  StepSchema,
} from '../../../src/shared/types';

const TAB = 42;
const URL_1 = 'https://jobs.example.com/apply/123';
const RESUME = {
  basics: { name: 'Ana Example', email: 'ana@example.com' },
  work: [{ name: 'Acme' }, { name: 'Globex' }],
};

function field(id: string, overrides: Partial<FieldSchema> = {}): FieldSchema {
  return {
    id,
    frameId: 0,
    origin: 'https://jobs.example.com',
    selector: `#${id}`,
    type: 'text',
    label: id,
    labelSource: 'label-for',
    required: false,
    value: '',
    ...overrides,
  };
}

function button(kind: ButtonInfo['kind'], text: string, disabled = false): ButtonInfo {
  return { frameId: 0, selector: `#${text}`, text, kind, disabled };
}

const NEXT = button('advance', 'Next');
const SUBMIT = button('submit', 'Submit application');

function step(
  fields: FieldSchema[],
  buttons: ButtonInfo[] = [NEXT],
  extra: Partial<StepSchema> = {},
): StepSchema {
  return {
    signature: stepSignature(fields),
    url: URL_1,
    fields,
    buttons,
    repeatables: [],
    blockedOrigins: [],
    ...extra,
  };
}

/** Decides like a model that knows the answer to every field: "value of <id>". */
const fillEverything: Mapper['map'] = ({ fields }) =>
  Promise.resolve(
    fields.map((f): FieldDecision => ({
      fieldId: f.id,
      action: 'fill',
      value: `value of ${f.id}`,
      confidence: 0.95,
      origin: 'llm',
      source: 'basics.name',
    })),
  );

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : never;
};

describe('Orchestrator', () => {
  let store: InMemoryStore;
  let settings: SettingsRepository;
  let answers: AnswerBank;
  let cache: MappingCache;
  let states: StateStore;
  let tabs: Mocked<TabGateway>;
  let mapper: Mocked<Pick<Mapper, 'map' | 'chooseAdvanceButton'>>;
  let published: RunState[];
  let orchestrator: Orchestrator;

  function createOrchestrator(): Orchestrator {
    return new Orchestrator({
      settings,
      resume: new ResumeRepository(store),
      resumeFile: new ResumeFileRepository(store),
      answers,
      cache,
      states,
      mapper: mapper as unknown as Mapper,
      tabs,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      onChange: (state) => published.push(state),
    });
  }

  /** Makes the page report these steps, one per read, repeating the last one. */
  function pageShows(...steps: StepSchema[]): void {
    tabs.extract.mockReset();
    steps.forEach((s, index) => {
      if (index === steps.length - 1) tabs.extract.mockResolvedValue(s);
      else tabs.extract.mockResolvedValueOnce(s);
    });
  }

  beforeEach(async () => {
    store = new InMemoryStore();
    settings = new SettingsRepository(store);
    answers = new AnswerBank(store);
    cache = new MappingCache(store);
    states = new StateStore(store);
    await settings.save({ apiKey: 'key-1', model: 'model-1', fillDelayMs: 25 });
    await new ResumeRepository(store).save(RESUME);

    tabs = {
      url: vi.fn<TabGateway['url']>().mockResolvedValue(URL_1),
      extract: vi.fn<TabGateway['extract']>(),
      fill: vi
        .fn<TabGateway['fill']>()
        .mockImplementation((_tab, _step, decisions) =>
          Promise.resolve(
            decisions.map((d) => ({ fieldId: d.fieldId, status: 'filled' as const })),
          ),
        ),
      advance: vi.fn<TabGateway['advance']>().mockResolvedValue('advanced'),
      addBlock: vi.fn<TabGateway['addBlock']>().mockResolvedValue(true),
    };
    mapper = {
      map: vi.fn<Mapper['map']>().mockImplementation(fillEverything),
      chooseAdvanceButton: vi.fn<Mapper['chooseAdvanceButton']>().mockResolvedValue(null),
    };
    published = [];
    orchestrator = createOrchestrator();
  });

  async function settled(): Promise<RunState> {
    await orchestrator.whenSettled(TAB);
    const state = await orchestrator.get(TAB);
    if (!state) throw new Error('No state');
    return state;
  }

  async function run(): Promise<RunState> {
    await orchestrator.start(TAB);
    return settled();
  }

  async function confirm(): Promise<RunState> {
    await orchestrator.confirm(TAB);
    return settled();
  }

  const phases = () =>
    published.map((state) => state.phase).filter((p, i, all) => p !== all[i - 1]);
  const filledIds = (call: number) => tabs.fill.mock.calls[call]?.[2].map((d) => d.fieldId);
  const askedIds = (call: number) => mapper.map.mock.calls[call]?.[0].fields.map((f) => f.id);

  describe('one step', () => {
    it('reads, decides, fills, checks and waits for the review', async () => {
      const name = field('name');
      pageShows(step([name]), step([{ ...name, value: 'value of name' }]));
      const state = await run();

      expect(phases()).toEqual([
        'EXTRACTING',
        'MAPPING',
        'FILLING',
        'VALIDATING',
        'WAITING_USER_REVIEW',
      ]);
      expect(state).toMatchObject({
        key: 'jobs.example.com/apply/123',
        stepNumber: 1,
        decisions: [{ fieldId: 'name', action: 'fill', value: 'value of name' }],
        results: [{ fieldId: 'name', status: 'filled' }],
      });
      expect(mapper.map).toHaveBeenCalledWith(
        { fields: [name], resume: RESUME, answers: [] },
        { apiKey: 'key-1', model: 'model-1' },
      );
      expect(tabs.fill).toHaveBeenCalledWith(TAB, expect.anything(), expect.anything(), 25, null);
    });

    it('goes straight to the final review when the only way forward is Submit', async () => {
      pageShows(step([field('name')], [SUBMIT]));
      expect((await run()).phase).toBe('FINAL_REVIEW');
    });

    it('treats a page with only a Submit button as the final review', async () => {
      pageShows(step([], [button('other', 'Back'), SUBMIT]));
      expect((await run()).phase).toBe('FINAL_REVIEW');
      expect(mapper.map).not.toHaveBeenCalled();
    });

    it('waits on a step with nothing to fill but a way forward', async () => {
      pageShows(step([], [NEXT]));
      expect((await run()).phase).toBe('WAITING_USER_REVIEW');
    });

    it('passes the job description to the model and keeps it for later steps', async () => {
      pageShows(step([field('cover')]));
      await orchestrator.start(TAB, { jobDescription: '  Senior engineer  ' });
      await settled();
      expect(mapper.map.mock.calls[0]?.[0].jobDescription).toBe('Senior engineer');
    });

    it('does not start a second run while one is in progress', async () => {
      pageShows(step([field('name')]));
      await orchestrator.start(TAB);
      await orchestrator.start(TAB);
      await settled();
      expect(mapper.map).toHaveBeenCalledOnce();
    });

    it('decides again a field that only shows up after the others are filled', async () => {
      const employed = field('employed');
      const notice = field('notice');
      pageShows(step([employed]), step([{ ...employed, value: 'yes' }, notice]));
      const state = await run();

      expect(askedIds(0)).toEqual(['employed']);
      expect(askedIds(1)).toEqual(['notice']);
      expect(state.decisions.map((d) => d.fieldId)).toEqual(['employed', 'notice']);
    });
  });

  describe('failures', () => {
    it.each([
      ['the API key is missing', () => settings.save({ apiKey: '' }), 'missing_api_key'],
      ['there is no resume', () => store.remove('resume'), 'missing_resume'],
    ] as const)('stops before touching the page when %s', async (_, arrange, code) => {
      await arrange();
      pageShows(step([field('name')]));
      expect(await run()).toMatchObject({ phase: 'ERROR', error: { code } });
      expect(tabs.extract).not.toHaveBeenCalled();
    });

    it('explains when it has no access to the tab', async () => {
      tabs.extract.mockRejectedValue(new InjectionError('Cannot access contents of the page'));
      expect(await run()).toMatchObject({ phase: 'ERROR', error: { code: 'injection_failed' } });
    });

    it('reports a page with neither fields nor a way forward', async () => {
      pageShows(step([], []));
      expect(await run()).toMatchObject({ phase: 'ERROR', error: { code: 'no_fields' } });
    });

    it.each([
      ['auth', 'llm_auth'],
      ['rate_limit', 'llm_rate_limit'],
      ['refusal', 'llm_refusal'],
    ] as const)(
      'reports a %s failure of the model without filling anything',
      async (kind, code) => {
        mapper.map.mockRejectedValue(new LlmError(kind, 'details'));
        pageShows(step([field('name')]));
        expect(await run()).toMatchObject({ phase: 'ERROR', error: { code, detail: 'details' } });
        expect(tabs.fill).not.toHaveBeenCalled();
      },
    );

    it('can be started again after an error', async () => {
      tabs.extract.mockRejectedValueOnce(new Error('The tab was busy'));
      tabs.extract.mockResolvedValue(step([field('name')]));
      expect(await run()).toMatchObject({ phase: 'ERROR', error: { code: 'unexpected' } });
      expect((await run()).phase).toBe('WAITING_USER_REVIEW');
    });
  });

  describe('validation errors', () => {
    it('asks the model again with the error, only for the rejected field', async () => {
      const birth = field('birth');
      const name = field('name');
      const rejected = { ...birth, value: '1991-08-20', error: 'Use DD/MM/YYYY' };
      pageShows(
        step([name, birth]),
        step([{ ...name, value: 'x' }, rejected]),
        step([
          { ...name, value: 'x' },
          { ...birth, value: '20/08/1991' },
        ]),
      );
      const state = await run();

      expect(askedIds(1)).toEqual(['birth']);
      expect(mapper.map.mock.calls[1]?.[0].fields[0]?.error).toBe('Use DD/MM/YYYY');
      expect(state.results).toContainEqual({ fieldId: 'birth', status: 'filled' });
      expect(state.phase).toBe('WAITING_USER_REVIEW');
    });

    it('hands the field to the user after the first try and two corrections', async () => {
      const postal = field('postal');
      pageShows(step([postal]), step([{ ...postal, value: '1000', error: 'Not served' }]));
      const state = await run();

      expect(mapper.map).toHaveBeenCalledTimes(3);
      expect(tabs.fill).toHaveBeenCalledTimes(3);
      expect(state.decisions).toEqual([
        { fieldId: 'postal', action: 'ask_user', confidence: 0, reason: 'Not served' },
      ]);
      expect(state.results).toEqual([{ fieldId: 'postal', status: 'failed', error: 'Not served' }]);
    });
  });

  describe('moving between steps', () => {
    const first = step([field('name')]);
    const second = step([field('phone')]);

    it('advances only when the user confirms, then fills the next step', async () => {
      pageShows(first, first, second);
      await run();
      expect(tabs.advance).not.toHaveBeenCalled();

      const state = await confirm();
      expect(tabs.advance).toHaveBeenCalledWith(TAB, NEXT);
      expect(state).toMatchObject({ phase: 'WAITING_USER_REVIEW', stepNumber: 2 });
      expect(state.decisions.map((d) => d.fieldId)).toEqual(['phone']);
    });

    it('cannot be confirmed past the final review: Submit is never clicked', async () => {
      pageShows(step([field('name')], [SUBMIT]));
      await run();

      await expect(orchestrator.confirm(TAB)).rejects.toBeInstanceOf(InvalidTransitionError);
      expect(tabs.advance).not.toHaveBeenCalled();
    });

    it('stops at the final review when the page refuses the click as a submit', async () => {
      pageShows(first);
      tabs.advance.mockResolvedValue('refused');
      await run();
      expect((await confirm()).phase).toBe('FINAL_REVIEW');
    });

    it('reads a blocked step again and tells what seems to be missing', async () => {
      const salary = field('salary', { required: true, label: 'Salary' });
      mapper.map.mockResolvedValue([{ fieldId: 'salary', action: 'ask_user', confidence: 0 }]);
      pageShows(step([salary]));
      tabs.advance.mockResolvedValue('disabled');
      await run();
      const state = await confirm();

      expect(state.phase).toBe('WAITING_USER_REVIEW');
      expect(state.notice).toEqual({ code: 'next_disabled', missing: ['Salary'] });
      expect(tabs.advance).toHaveBeenCalledOnce();
    });

    it('tries once more when reading the blocked step again filled something new', async () => {
      const name = field('name');
      const late = field('late');
      pageShows(
        step([name]),
        step([{ ...name, value: 'x' }]),
        step([{ ...name, value: 'x' }, late]),
        second,
      );
      tabs.advance.mockResolvedValueOnce('disabled').mockResolvedValueOnce('advanced');
      await run();
      const state = await confirm();

      expect(tabs.advance).toHaveBeenCalledTimes(2);
      expect(state.stepNumber).toBe(2);
    });

    it('reports a click that changed nothing', async () => {
      pageShows(step([field('name', { value: 'x' })]));
      tabs.advance.mockResolvedValue('unchanged');
      await run();
      expect((await confirm()).notice).toEqual({ code: 'step_unchanged' });
    });

    it('lets the model choose between several buttons that look like "next"', async () => {
      const save = button('advance', 'Save and continue');
      pageShows(step([field('name')], [NEXT, save]), step([field('name')], [NEXT, save]), second);
      mapper.chooseAdvanceButton.mockResolvedValue(save);
      await run();
      await confirm();

      expect(mapper.chooseAdvanceButton).toHaveBeenCalledWith([NEXT, save], expect.anything());
      expect(tabs.advance).toHaveBeenCalledWith(TAB, save);
    });

    it('asks the model about unlabelled buttons, never offering one that may submit', async () => {
      const onward = button('other', 'Onward');
      const back = button('other', 'Back');
      pageShows(step([field('name')], [back, onward]));
      await run();
      await confirm();
      expect(mapper.chooseAdvanceButton).toHaveBeenCalledWith([back, onward], expect.anything());

      const state = await orchestrator.get(TAB);
      expect(state?.notice).toEqual({ code: 'no_next_button' });
      expect(tabs.advance).not.toHaveBeenCalled();
    });

    it('moves on by itself when allowed and everything is confidently filled', async () => {
      await settings.save({ autoAdvance: true });
      pageShows(first, first, step([field('salary')], [SUBMIT]));
      const state = await run();

      expect(tabs.advance).toHaveBeenCalledOnce();
      expect(state).toMatchObject({ phase: 'FINAL_REVIEW', stepNumber: 2 });
    });

    it.each([
      ['a field needs the user', { action: 'ask_user', confidence: 0 }],
      ['confidence is low', { action: 'fill', value: 'x', confidence: 0.5 }],
      ['a value needs review', { action: 'fill', value: 'x', confidence: 1, needsReview: true }],
    ] as const)('does not move on by itself when %s', async (_, decision) => {
      await settings.save({ autoAdvance: true });
      mapper.map.mockResolvedValue([{ fieldId: 'name', ...decision }]);
      pageShows(first);
      await run();
      expect(tabs.advance).not.toHaveBeenCalled();
    });
  });

  describe('repeatable sections', () => {
    const add = {
      frameId: 0,
      selector: '#add',
      text: 'Add experience',
      kinds: ['work' as const],
      existingBlocks: 1,
    };

    it('adds blocks until there is one per resume entry', async () => {
      const company = field('company');
      pageShows(
        step([company], [NEXT], { repeatables: [add] }),
        step([company, field('company2')]),
      );
      await run();
      expect(tabs.addBlock).toHaveBeenCalledExactlyOnceWith(TAB, add);
    });

    it('stops at the size of the resume when the blocks on the page cannot be counted', async () => {
      // The count never moves, and filling gives the retry a chance to add even more.
      pageShows(step([field('company')], [NEXT], { repeatables: [{ ...add, existingBlocks: 0 }] }));
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(2);
    });

    it('adds one block per entry of every kind a mixed section takes', async () => {
      await new ResumeRepository(store).save({
        ...RESUME,
        education: [{ institution: 'A' }, { institution: 'B' }],
        certificates: [{ name: 'C' }],
      });
      const mixed = { ...add, kinds: ['education' as const, 'certificates' as const] };
      pageShows(step([field('course')], [NEXT], { repeatables: [mixed] }), step([field('course')]));
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(2);
    });

    it('keeps counting what it added when adding a block moves the button', async () => {
      const moved = (selector: string) => ({ ...add, selector, existingBlocks: 0 });
      pageShows(
        step([field('company')], [NEXT], { repeatables: [moved('div:nth-of-type(2) > button')] }),
        step([field('company')], [NEXT], { repeatables: [moved('div:nth-of-type(4) > button')] }),
      );
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(2);
    });

    it('reports the blocks it could not add, after one more try once the fields are filled', async () => {
      tabs.addBlock.mockResolvedValue(false);
      pageShows(step([field('company')], [NEXT], { repeatables: [{ ...add, existingBlocks: 0 }] }));
      const state = await run();

      expect(tabs.addBlock).toHaveBeenCalledTimes(2);
      expect(state.shortfalls).toEqual([{ button: 'Add experience', missing: 2 }]);
    });

    it('adds the block a form only allows after the previous one is filled', async () => {
      const company = field('company');
      const second = field('company2');
      const withButton = (fields: FieldSchema[], existingBlocks: number) =>
        step(fields, [NEXT], { repeatables: [{ ...add, existingBlocks }] });
      tabs.addBlock.mockResolvedValueOnce(false).mockResolvedValue(true);
      pageShows(
        withButton([company], 1),
        withButton([{ ...company, value: 'x' }], 1),
        withButton([{ ...company, value: 'x' }, second], 2),
      );
      const state = await run();

      expect(askedIds(0)).toEqual(['company']);
      expect(askedIds(1)).toEqual(['company2']);
      expect(state.shortfalls).toBeUndefined();
      expect(state.decisions.map((d) => d.fieldId)).toEqual(['company', 'company2']);
    });

    it('fills every block of a long list that grows one block per pass', async () => {
      const jobs = Array.from({ length: 14 }, (_, index) => ({ name: `Company ${index + 1}` }));
      await new ResumeRepository(store).save({ ...RESUME, work: jobs });
      let blocks = 1;
      let filledBlocks = 0;
      // The form refuses a new block until the last one on the page is filled in.
      tabs.addBlock.mockImplementation(() => {
        if (filledBlocks < blocks) return Promise.resolve(false);
        blocks += 1;
        return Promise.resolve(true);
      });
      tabs.fill.mockImplementation((_tab, _step, decisions) => {
        filledBlocks = blocks;
        return Promise.resolve(
          decisions.map((d) => ({ fieldId: d.fieldId, status: 'filled' as const })),
        );
      });
      tabs.extract.mockImplementation(() =>
        Promise.resolve(
          step(
            Array.from({ length: blocks }, (_, index) =>
              field(`company${index}`, { value: index < filledBlocks ? 'x' : '' }),
            ),
            [NEXT],
            { repeatables: [{ ...add, existingBlocks: blocks }] },
          ),
        ),
      );
      const state = await run();

      expect(blocks).toBe(14);
      expect(state.decisions).toHaveLength(14);
      expect(state.decisions.every((decision) => decision.action === 'fill')).toBe(true);
      expect(state.shortfalls).toBeUndefined();
      expect(state.phase).toBe('WAITING_USER_REVIEW');
    });

    it('adds again when a later reading finds fewer blocks than the resume needs', async () => {
      const counted = (existingBlocks: number) =>
        step([field('company')], [NEXT], { repeatables: [{ ...add, existingBlocks }] });
      pageShows(counted(1), counted(2));
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(1);

      // The user deleted a block, or the page went back to what was saved.
      pageShows(counted(1), counted(2));
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(2);
    });

    it('is not held back by earlier readings when the "Add" button vanishes after each click', async () => {
      const jobs = Array.from({ length: 5 }, (_, index) => ({ name: `Company ${index + 1}` }));
      await new ResumeRepository(store).save({ ...RESUME, work: jobs });
      let blocks = 1;
      let filledBlocks = 0;
      tabs.addBlock.mockImplementation(() => {
        if (filledBlocks < blocks) return Promise.resolve(false);
        blocks += 1;
        return Promise.resolve(true);
      });
      tabs.fill.mockImplementation((_tab, _step, decisions) => {
        filledBlocks = blocks;
        return Promise.resolve(
          decisions.map((d) => ({ fieldId: d.fieldId, status: 'filled' as const })),
        );
      });
      // While the last block is empty the form shows a disabled button, which is not offered.
      tabs.extract.mockImplementation(() =>
        Promise.resolve(
          step(
            Array.from({ length: blocks }, (_, index) =>
              field(`company${index}`, { value: index < filledBlocks ? 'x' : '' }),
            ),
            [NEXT],
            { repeatables: filledBlocks < blocks ? [] : [{ ...add, existingBlocks: blocks }] },
          ),
        ),
      );
      await run();
      expect(blocks).toBe(5);

      // The page is reloaded without saving: one filled block again.
      blocks = 1;
      filledBlocks = 1;
      await orchestrator.start(TAB, { redo: true });
      await settled();
      expect(blocks).toBe(5);
    });

    it('finds the next button again after adding blocks moved it', async () => {
      const languages = (selector: string) => ({
        frameId: 0,
        selector,
        text: 'Add language',
        kinds: ['work' as const],
        existingBlocks: 1,
      });
      pageShows(
        step([field('company')], [NEXT], {
          repeatables: [add, languages('div:nth-of-type(3) > button')],
        }),
        step([field('company')], [NEXT], {
          repeatables: [{ ...add, existingBlocks: 2 }, languages('div:nth-of-type(4) > button')],
        }),
      );
      await run();

      const clicked = tabs.addBlock.mock.calls.map(([, repeatable]) => repeatable.selector);
      expect(clicked.slice(0, 2)).toEqual(['#add', 'div:nth-of-type(4) > button']);
    });

    it('forgets how many blocks it added when the step is done over', async () => {
      const uncounted = step([field('company')], [NEXT], {
        repeatables: [{ ...add, existingBlocks: 0 }],
      });
      pageShows(uncounted);
      await run();
      expect(tabs.addBlock).toHaveBeenCalledTimes(2);

      await orchestrator.start(TAB, { redo: true });
      await settled();
      expect(tabs.addBlock).toHaveBeenCalledTimes(4);
    });
  });

  describe('cache and answers', () => {
    it('remembers a confirmed step and fills it next time without the model', async () => {
      const name = field('name', { label: 'Full name' });
      pageShows(step([name]), step([{ ...name, value: 'value of name' }]));
      await run();
      await confirm();
      expect(await cache.summary()).toEqual([{ domain: 'jobs.example.com', steps: 1, fields: 1 }]);

      // Another job on the same portal: a different address and field ids, the same labels.
      tabs.url.mockResolvedValue('https://jobs.example.com/apply/456');
      mapper.map.mockClear();
      const other = field('other-id', { label: 'Full name' });
      pageShows(step([other]));
      const state = await run();

      expect(mapper.map).not.toHaveBeenCalled();
      expect(state.decisions).toEqual([
        {
          fieldId: 'other-id',
          action: 'fill',
          value: 'value of name',
          confidence: 1,
          origin: 'cache',
          source: 'basics.name',
        },
      ]);
    });

    it("fills a field with the user's answer and keeps it in the bank", async () => {
      const salary = field('salary', { label: 'Salary expectation' });
      mapper.map.mockResolvedValue([{ fieldId: 'salary', action: 'ask_user', confidence: 0 }]);
      pageShows(step([salary]));
      await run();
      const state = await orchestrator.answer(TAB, 'salary', '65000');

      const [entry] = await answers.list();
      expect(entry).toMatchObject({ question: 'Salary expectation', answer: '65000' });
      expect(state.decisions).toEqual([
        {
          fieldId: 'salary',
          action: 'fill',
          value: '65000',
          confidence: 1,
          origin: 'user',
          source: `answers.${entry?.id}`,
        },
      ]);
      expect(state.results).toEqual([{ fieldId: 'salary', status: 'filled' }]);
    });

    it('does not keep an answer for a field known only by its format', async () => {
      const date = field('date', { label: 'dd-mm-aaaa', labelSource: 'placeholder' });
      mapper.map.mockResolvedValue([{ fieldId: 'date', action: 'ask_user', confidence: 0 }]);
      pageShows(step([date]));
      await run();
      await orchestrator.answer(TAB, 'date', '24-05-1989');
      expect(await answers.list()).toEqual([]);
    });

    it('does not keep consent answers', async () => {
      const privacy = field('privacy', { type: 'checkbox', value: false });
      mapper.map.mockResolvedValue([{ fieldId: 'privacy', action: 'ask_user', confidence: 0 }]);
      pageShows(step([privacy]));
      await run();
      const state = await orchestrator.answer(TAB, 'privacy', true);

      expect(await answers.list()).toEqual([]);
      expect(state.decisions[0]).not.toHaveProperty('source');
    });

    it.each([
      ['text for a checkbox', { type: 'checkbox' }, 'yes'],
      ['a value outside the options', { type: 'select', options: ['A', 'B'] }, 'C'],
      ['an empty answer', {}, '  '],
    ] as const)('rejects %s', async (_, overrides, value) => {
      pageShows(step([field('target', overrides as Partial<FieldSchema>)]));
      await run();
      await expect(orchestrator.answer(TAB, 'target', value)).rejects.toThrow('does not fit');
      await expect(orchestrator.answer(TAB, 'nope', 'x')).rejects.toThrow('Unknown field');
    });

    it('offers stored answers to the model', async () => {
      await answers.remember('Notice period', '60 days');
      pageShows(step([field('notice')]));
      await run();
      expect(mapper.map.mock.calls[0]?.[0].answers).toMatchObject([
        { question: 'Notice period', answer: '60 days' },
      ]);
    });
  });

  describe('resuming', () => {
    const name = field('name');
    const filled = step([{ ...name, value: 'value of name' }]);

    it('flags a reload while waiting, and restores the values without the model', async () => {
      pageShows(step([name]), filled);
      await run();
      await orchestrator.onTabReloaded(TAB);
      expect((await orchestrator.get(TAB))?.notice).toEqual({ code: 'page_reloaded' });

      mapper.map.mockClear();
      tabs.fill.mockClear();
      pageShows(step([name]), filled);
      const state = await run();

      expect(mapper.map).not.toHaveBeenCalled();
      expect(filledIds(0)).toEqual(['name']);
      expect(state.notice).toBeUndefined();
      expect(state.results).toEqual([{ fieldId: 'name', status: 'filled' }]);
    });

    it('does not refill what the page still shows', async () => {
      pageShows(step([name]), filled);
      await run();
      tabs.fill.mockClear();
      pageShows(filled);
      await run();
      expect(tabs.fill).not.toHaveBeenCalled();
    });

    it('survives the service worker restarting and the tab being reopened', async () => {
      pageShows(step([name]), filled);
      await run();
      await orchestrator.onTabClosed(TAB);

      orchestrator = createOrchestrator();
      expect(await orchestrator.get(TAB)).toBeNull();
      mapper.map.mockClear();
      pageShows(step([name]), filled);
      await orchestrator.start(77);
      await orchestrator.whenSettled(77);

      expect(mapper.map).not.toHaveBeenCalled();
      expect(await orchestrator.get(77)).toMatchObject({ tabId: 77, phase: 'WAITING_USER_REVIEW' });
    });

    describe('doing the step over', () => {
      const birth = field('birth');
      const salary = field('salary');
      const country = field('country', { type: 'select', options: ['Portugal'] });
      const decideAs = (action: 'fill' | 'ask_user') =>
        mapper.map.mockImplementation(({ fields }) =>
          Promise.resolve(
            fields.map((f): FieldDecision =>
              f.id === 'salary' && action === 'ask_user'
                ? { fieldId: f.id, action: 'ask_user', confidence: 0, origin: 'llm' }
                : {
                    fieldId: f.id,
                    action: 'fill',
                    value: f.id === 'country' ? 'Portugal' : `v-${f.id}`,
                    confidence: 1,
                    origin: 'llm',
                  },
            ),
          ),
        );
      const shown = step([
        { ...birth, value: 'v-birth' },
        { ...salary, value: '65000' },
        { ...country, value: 'Portugal' },
      ]);

      async function firstPass(): Promise<void> {
        decideAs('ask_user');
        pageShows(step([birth, salary, country]), shown);
        await run();
        await orchestrator.answer(TAB, 'salary', '65000');
        mapper.map.mockClear();
        tabs.fill.mockClear();
      }

      it('forgets the step, empties the text it had typed and decides everything again', async () => {
        await firstPass();
        decideAs('fill');
        pageShows(
          shown,
          step([birth, { ...salary, value: '65000' }, { ...country, value: 'Portugal' }]),
        );
        await orchestrator.start(TAB, { redo: true });
        const state = await settled();

        // Only its own typed text is emptied: not the user's answer, not a chosen option.
        expect(tabs.fill.mock.calls[0]?.[2]).toEqual([
          { fieldId: 'birth', action: 'fill', value: '', confidence: 0 },
        ]);
        expect(askedIds(0)).toEqual(['birth', 'salary', 'country']);
        expect(state.decisions.map((d) => d.origin)).toEqual(['llm', 'llm', 'llm']);
        expect(state.attempts).toEqual({ birth: 1, salary: 1, country: 1 });
      });

      it('clears what was pending review in the panel while it works', async () => {
        await firstPass();
        pageShows(shown);
        published.length = 0;
        await orchestrator.start(TAB, { redo: true });
        await settled();

        const wiped = published.find((state) => state.decisions.length === 0);
        expect(wiped).toMatchObject({ results: [], decided: {}, attempts: {} });
      });

      it('does not take the answers from the cache', async () => {
        pageShows(step([birth]), step([{ ...birth, value: 'value of birth' }]));
        await run();
        await confirm();
        expect(await cache.summary()).toHaveLength(1);

        mapper.map.mockClear();
        pageShows(step([{ ...birth, value: 'value of birth' }]));
        await orchestrator.start(TAB, { redo: true });
        await settled();
        expect(askedIds(0)).toEqual(['birth']);
      });

      it('keeps what was decided on other steps', async () => {
        const phone = field('phone');
        pageShows(step([birth]), step([{ ...birth, value: 'x' }]), step([phone]));
        await run();
        await confirm();
        pageShows(step([{ ...phone, value: 'value of phone' }]));
        await orchestrator.start(TAB, { redo: true });
        const state = await settled();

        expect(Object.keys(state.decided).sort()).toEqual(['birth', 'phone']);
        expect(state.stepNumber).toBe(2);
      });
    });

    it('starts from scratch when asked to', async () => {
      pageShows(step([name]), filled);
      await run();
      mapper.map.mockClear();
      pageShows(step([name]), filled);
      await orchestrator.start(TAB, { fresh: true });
      await settled();
      expect(mapper.map).toHaveBeenCalledOnce();
    });

    it('ignores reloads while it is working or has nothing to restore', async () => {
      await orchestrator.onTabReloaded(TAB);
      expect(await orchestrator.get(TAB)).toBeNull();
    });

    it('forgets a finished application and remembers its last step', async () => {
      pageShows(step([name], [SUBMIT]), step([{ ...name, value: 'value of name' }], [SUBMIT]));
      await run();
      const state = await orchestrator.finish(TAB);

      expect(state.phase).toBe('DONE');
      expect(await states.loadByKey(state.key)).toBeNull();
      expect(await cache.summary()).toHaveLength(1);
    });

    it('cannot finish before the final review', async () => {
      pageShows(step([name]));
      await run();
      await expect(orchestrator.finish(TAB)).rejects.toBeInstanceOf(InvalidTransitionError);
    });
  });
});
