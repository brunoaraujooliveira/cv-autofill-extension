import { beforeEach, describe, expect, it } from 'vitest';
import { AnswerBank } from '../../../src/background/storage/answer-bank';
import { InMemoryStore } from '../../../src/background/storage/key-value-store';
import { MappingCache } from '../../../src/background/storage/mapping-cache';
import { MAX_FILE_BYTES, ResumeFileRepository } from '../../../src/background/storage/resume-file';
import { NO_TAB, runKey, StateStore } from '../../../src/background/storage/state-store';
import { mergeSnapshots } from '../../../src/background/step-merge';
import type {
  FieldDecision,
  FieldSchema,
  FrameSnapshot,
  RunState,
} from '../../../src/shared/types';

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

const fill = (
  fieldId: string,
  value: NonNullable<FieldDecision['value']>,
  extra: Partial<FieldDecision> = {},
): FieldDecision => ({
  fieldId,
  action: 'fill',
  value,
  confidence: 0.9,
  origin: 'llm',
  ...extra,
});

describe('AnswerBank', () => {
  let clock: number;
  let bank: AnswerBank;

  beforeEach(() => {
    clock = 1000;
    bank = new AnswerBank(new InMemoryStore(), () => clock);
  });

  it('keeps one answer per question, however it is spelled', async () => {
    const first = await bank.remember('Notice period', '30 days');
    clock = 2000;
    const second = await bank.remember('  notice PERIOD: ', '60 days');

    expect(second.id).toBe(first.id);
    expect(await bank.list()).toEqual([
      { id: first.id, question: '  notice PERIOD: ', answer: '60 days', updatedAt: 2000 },
    ]);
  });

  it('edits and removes answers by id', async () => {
    const salary = await bank.remember('Salary', '60000');
    const notice = await bank.remember('Notice period', '30 days');
    clock = 3000;

    expect(await bank.update(salary.id, '65000')).toContainEqual({
      ...salary,
      answer: '65000',
      updatedAt: 3000,
    });
    expect(await bank.remove(salary.id)).toEqual([notice]);
  });

  it('leaves out questions that are only a format', async () => {
    await bank.remember('dd-mm-aaaa', '24-05-1989');
    await bank.remember('Date of birth', '24-05-1989');
    expect((await bank.list()).map((entry) => entry.question)).toEqual(['Date of birth']);
  });

  it('starts empty and ignores unreadable storage', async () => {
    const store = new InMemoryStore();
    await store.set('answers', 'garbage');
    expect(await new AnswerBank(store).list()).toEqual([]);
  });
});

describe('MappingCache', () => {
  const DOMAIN = 'jobs.example.com';
  const resume = {
    basics: { name: 'Ana Example', email: 'ana@example.com' },
    work: [{ name: 'Acme' }],
  };
  const data = {
    resume,
    answers: [{ id: 'a1', question: 'Notice', answer: '60 days', updatedAt: 1 }],
  };
  let cache: MappingCache;

  beforeEach(() => {
    cache = new MappingCache(new InMemoryStore());
  });

  it('gives back what was stored for a step, re-keyed to the fields of the new page', async () => {
    const saved = [field('f1', { label: 'Email' }), field('f2', { label: 'Fax' })];
    await cache.save(
      DOMAIN,
      'sig',
      saved,
      [
        fill('f1', 'ana@example.com', { source: 'basics.email' }),
        { fieldId: 'f2', action: 'skip', confidence: 1 },
      ],
      data,
    );

    const now = [
      field('x9', { label: 'Email' }),
      field('x8', { label: 'Fax' }),
      field('x7', { label: 'New' }),
    ];
    expect(await cache.lookup(DOMAIN, 'sig', now, data)).toEqual([
      {
        fieldId: 'x9',
        action: 'fill',
        value: 'ana@example.com',
        confidence: 1,
        origin: 'cache',
        source: 'basics.email',
      },
      { fieldId: 'x8', action: 'skip', confidence: 1, origin: 'cache' },
    ]);
  });

  it('tells apart repeated fields by the index of their group', async () => {
    const group = (index: number) => ({
      key: `g${index}`,
      label: `Experience ${index + 1}`,
      index,
    });
    const fields = [
      field('a', { label: 'Company', group: group(0) }),
      field('b', { label: 'Company', group: group(1) }),
    ];
    await cache.save(
      DOMAIN,
      'sig',
      fields,
      [fill('a', 'Acme', { source: 'work[0].name' }), fill('b', 'Globex')],
      data,
    );

    const found = await cache.lookup(DOMAIN, 'sig', fields, data);
    expect(found.map((decision) => decision.value)).toEqual(['Acme', 'Globex']);
  });

  it('drops an entry once the resume data it came from changes', async () => {
    const fields = [field('f1', { label: 'Email' }), field('f2', { label: 'Summary' })];
    await cache.save(
      DOMAIN,
      'sig',
      fields,
      [fill('f1', 'ana@example.com', { source: 'basics.email' }), fill('f2', 'derived')],
      data,
    );

    const sameEmail = { ...data, resume: { ...resume, work: [] } };
    expect((await cache.lookup(DOMAIN, 'sig', fields, sameEmail)).map((d) => d.fieldId)).toEqual([
      'f1',
    ]);

    const newEmail = {
      ...data,
      resume: { ...resume, basics: { ...resume.basics, email: 'new@example.com' } },
    };
    expect(await cache.lookup(DOMAIN, 'sig', fields, newEmail)).toEqual([]);
  });

  it('follows answers from the bank and forgets them when they are edited or deleted', async () => {
    const fields = [field('f1', { label: 'Notice period' })];
    await cache.save(
      DOMAIN,
      'sig',
      fields,
      [fill('f1', '60 days', { source: 'answers.a1', origin: 'user' })],
      data,
    );

    expect(await cache.lookup(DOMAIN, 'sig', fields, data)).toHaveLength(1);
    expect(await cache.lookup(DOMAIN, 'sig', fields, { ...data, answers: [] })).toEqual([]);
  });

  it.each<[string, FieldDecision]>([
    ['generated text', fill('f1', 'Dear team', { needsReview: true })],
    ['questions left to the user', { fieldId: 'f1', action: 'ask_user', confidence: 0 }],
    ['answers typed for one form only', fill('f1', true, { origin: 'user' })],
    ['values from a path that does not exist', fill('f1', 'x', { source: 'basics.nickname' })],
  ])('never stores %s', async (_, decision) => {
    await cache.save(DOMAIN, 'sig', [field('f1')], [decision], data);
    expect(await cache.summary()).toEqual([]);
  });

  it('does not store or reuse values for fields showing an error', async () => {
    const good = field('f1', { label: 'Email' });
    await cache.save(
      DOMAIN,
      'sig',
      [{ ...good, error: 'Invalid' }],
      [fill('f1', 'x', { source: 'basics.email' })],
      data,
    );
    expect(await cache.summary()).toEqual([]);

    await cache.save(DOMAIN, 'sig', [good], [fill('f1', 'x', { source: 'basics.email' })], data);
    expect(await cache.lookup(DOMAIN, 'sig', [{ ...good, error: 'Invalid' }], data)).toEqual([]);
  });

  it('ignores fields known only by a format, which would match unrelated fields', async () => {
    const birth = field('f1', { label: 'dd-mm-aaaa' });
    await cache.save(DOMAIN, 'sig', [birth], [fill('f1', '24-05-1989')], data);
    expect(await cache.summary()).toEqual([]);
  });

  it('skips a cached option the field no longer offers', async () => {
    const country = field('f1', {
      label: 'Country',
      type: 'select',
      options: ['Portugal', 'Brazil'],
    });
    await cache.save(DOMAIN, 'sig', [country], [fill('f1', 'Portugal')], data);

    expect(await cache.lookup(DOMAIN, 'sig', [country], data)).toHaveLength(1);
    expect(await cache.lookup(DOMAIN, 'sig', [{ ...country, options: ['Spain'] }], data)).toEqual(
      [],
    );
  });

  it('covers a field from another step of the same portal, preferring the same step', async () => {
    const email = field('f1', { label: 'Email' });
    await cache.save(DOMAIN, 'step-1', [email], [fill('f1', 'old@example.com')], data);
    expect((await cache.lookup(DOMAIN, 'step-2', [email], data))[0]?.value).toBe('old@example.com');

    await cache.save(DOMAIN, 'step-2', [email], [fill('f1', 'new@example.com')], data);
    expect((await cache.lookup(DOMAIN, 'step-2', [email], data))[0]?.value).toBe('new@example.com');
    expect(await cache.lookup('other.example', 'step-2', [email], data)).toEqual([]);
  });

  it('summarizes by site and clears one site at a time', async () => {
    const fields = [field('f1'), field('f2')];
    const decisions = [fill('f1', 'a'), fill('f2', 'b')];
    await cache.save('b.example', 's1', fields, decisions, data);
    await cache.save('a.example', 's1', fields, decisions, data);
    await cache.save('a.example', 's2', [field('f1')], [fill('f1', 'a')], data);

    expect(await cache.summary()).toEqual([
      { domain: 'a.example', steps: 2, fields: 3 },
      { domain: 'b.example', steps: 1, fields: 2 },
    ]);
    await cache.clear('a.example');
    expect(await cache.summary()).toEqual([{ domain: 'b.example', steps: 1, fields: 2 }]);
  });
});

describe('ResumeFileRepository', () => {
  const PDF = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };

  it('stores one file and describes it', async () => {
    const repository = new ResumeFileRepository(new InMemoryStore());
    expect(await repository.load()).toBeNull();
    expect(await repository.save(PDF)).toEqual({
      name: 'resume.pdf',
      type: 'application/pdf',
      size: 13,
    });
    expect(await repository.load()).toEqual(PDF);
    await repository.remove();
    expect(await repository.load()).toBeNull();
  });

  it('rejects files that are too large or malformed', async () => {
    const repository = new ResumeFileRepository(new InMemoryStore());
    const huge = { ...PDF, base64: 'A'.repeat(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8) };
    await expect(repository.save(huge)).rejects.toThrow('larger than 4 MB');
    await expect(repository.save({ name: '', type: '', base64: '' })).rejects.toThrow();
  });
});

describe('StateStore', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const run = (key: string, tabId: number, updatedAt: number): RunState => ({
    tabId,
    key,
    phase: 'WAITING_USER_REVIEW',
    stepNumber: 1,
    decisions: [],
    results: [],
    decided: {},
    attempts: {},
    added: {},
    updatedAt,
  });
  let clock: number;
  let states: StateStore;

  beforeEach(() => {
    clock = 10 * DAY;
    states = new StateStore(new InMemoryStore(), () => clock);
  });

  it('finds a run by its tab or by its address', async () => {
    await states.save(run('a.example/apply', 1, clock));
    await states.save(run('b.example/apply', 2, clock));

    expect((await states.loadByTab(2))?.key).toBe('b.example/apply');
    expect((await states.loadByKey('a.example/apply'))?.tabId).toBe(1);
    expect(await states.loadByTab(3)).toBeNull();
    expect(await states.loadByKey('c.example')).toBeNull();
  });

  it('keeps every update when they are saved in quick succession', async () => {
    await Promise.all([
      states.save(run('a.example', 1, clock)),
      states.save(run('b.example', 2, clock)),
      states.save(run('c.example', 3, clock)),
    ]);
    expect(await Promise.all([1, 2, 3].map((tabId) => states.loadByTab(tabId)))).not.toContain(
      null,
    );
  });

  it('returns the most recent run of a tab', async () => {
    await states.save(run('old.example', 1, clock - 5));
    await states.save(run('new.example', 1, clock));
    expect((await states.loadByTab(1))?.key).toBe('new.example');
  });

  it('detaches runs from tabs but keeps them reachable by address', async () => {
    await states.save(run('a.example', 1, clock));
    await states.save(run('b.example', 2, clock));

    await states.detachTabs(1);
    expect(await states.loadByTab(1)).toBeNull();
    expect((await states.loadByKey('a.example'))?.tabId).toBe(NO_TAB);
    expect((await states.loadByTab(2))?.key).toBe('b.example');

    await states.detachTabs();
    expect(await states.loadByTab(2)).toBeNull();
  });

  it('removes runs and lets old ones expire', async () => {
    await states.save(run('a.example', 1, clock));
    await states.save(run('b.example', 2, clock));
    await states.remove('a.example');
    expect(await states.loadByKey('a.example')).toBeNull();

    clock += 8 * DAY;
    expect(await states.loadByKey('b.example')).toBeNull();
  });
});

describe('runKey', () => {
  it('uses host and path, ignoring query, hash and trailing slashes', () => {
    expect(runKey('https://jobs.example.com/apply/123/?step=2#top')).toBe(
      'jobs.example.com/apply/123',
    );
    expect(runKey('https://jobs.example.com/')).toBe('jobs.example.com');
    expect(runKey('not a url')).toBe('not a url');
  });
});

describe('mergeSnapshots', () => {
  const snapshot = (overrides: Partial<FrameSnapshot>): FrameSnapshot => ({
    origin: 'https://jobs.example.com',
    url: 'https://jobs.example.com/apply',
    fields: [],
    buttons: [],
    repeatables: [],
    iframeOrigins: [],
    ...overrides,
  });

  it('joins the frames into one step named after the top frame', () => {
    const next = {
      frameId: 3,
      selector: '#next',
      text: 'Next',
      kind: 'advance' as const,
      disabled: false,
    };
    const step = mergeSnapshots([
      {
        frameId: 3,
        snapshot: snapshot({
          origin: 'https://forms.example',
          url: 'https://forms.example/embed',
          title: 'Inner',
          fields: [field('email', { frameId: 3 })],
          buttons: [next],
        }),
      },
      {
        frameId: 0,
        snapshot: snapshot({
          title: 'Contact',
          fields: [field('name')],
          iframeOrigins: ['https://forms.example', 'https://ads.example'],
        }),
      },
    ]);

    expect(step).toMatchObject({
      url: 'https://jobs.example.com/apply',
      title: 'Contact',
      buttons: [next],
    });
    expect(step.fields.map((f) => f.id)).toEqual(['name', 'email']);
    expect(step.blockedOrigins).toEqual(['https://ads.example']);
  });

  it('gives the same signature to the same questions whatever the step is called', () => {
    const fields = [field('a', { label: 'Email', type: 'email' })];
    const one = mergeSnapshots([{ frameId: 0, snapshot: snapshot({ title: 'Job A', fields }) }]);
    const two = mergeSnapshots([{ frameId: 0, snapshot: snapshot({ title: 'Job B', fields }) }]);
    const other = mergeSnapshots([
      { frameId: 0, snapshot: snapshot({ fields: [field('a', { label: 'Phone' })] }) },
    ]);

    expect(one.signature).toBe(two.signature);
    expect(other.signature).not.toBe(one.signature);
  });

  it('survives having no frame at all', () => {
    expect(mergeSnapshots([])).toMatchObject({ url: '', fields: [], blockedOrigins: [] });
  });
});
