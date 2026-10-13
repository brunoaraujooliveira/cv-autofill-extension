import { describe, expect, it, vi } from 'vitest';
import {
  LlmError,
  type JsonCompletionRequest,
  type LlmClient,
} from '../../../src/background/llm/client';
import { Mapper } from '../../../src/background/llm/mapper';
import type { FieldSchema } from '../../../src/shared/types';

const CREDENTIALS = { apiKey: 'key-1', model: 'model-1' };
const RESUME = { basics: { name: 'Ana Example', email: 'ana@example.com' } };

function field(id: string, overrides: Partial<FieldSchema> = {}): FieldSchema {
  return {
    id,
    frameId: 3,
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

const wire = (fieldId: string, overrides: Record<string, unknown> = {}) => ({
  fieldId,
  action: 'fill',
  value: 'x',
  confidence: 0.9,
  reason: 'From the resume.',
  needsReview: false,
  ...overrides,
});

function createMapper(...answers: unknown[]) {
  const completeJson = vi.fn<LlmClient['completeJson']>();
  for (const answer of answers) completeJson.mockResolvedValueOnce(answer);
  const sentMessage = (call: number) =>
    JSON.parse((completeJson.mock.calls[call]?.[0] as JsonCompletionRequest).user) as Record<
      string,
      unknown
    >;
  return { mapper: new Mapper({ completeJson }), completeJson, sentMessage };
}

describe('Mapper', () => {
  it('returns validated decisions for a good answer', async () => {
    const fields = [field('name'), field('salary', { required: true }), field('fax')];
    const { mapper, completeJson } = createMapper({
      decisions: [
        wire('name', { value: 'Ana Example' }),
        wire('salary', {
          action: 'ask_user',
          value: null,
          confidence: 0,
          reason: 'Not in the resume.',
        }),
        wire('fax', { action: 'skip', value: null, reason: '' }),
      ],
    });

    expect(await mapper.map({ fields, resume: RESUME }, CREDENTIALS)).toEqual([
      {
        fieldId: 'name',
        action: 'fill',
        value: 'Ana Example',
        confidence: 0.9,
        origin: 'llm',
        reason: 'From the resume.',
      },
      {
        fieldId: 'salary',
        action: 'ask_user',
        confidence: 0,
        origin: 'llm',
        reason: 'Not in the resume.',
      },
      { fieldId: 'fax', action: 'skip', confidence: 0.9, origin: 'llm' },
    ]);
    expect(completeJson).toHaveBeenCalledOnce();
    expect(completeJson.mock.calls[0]?.[0]).toMatchObject(CREDENTIALS);
  });

  it('sends the model only what it needs: no selectors, frames or origins', async () => {
    const fields = [
      field('country', {
        type: 'select',
        options: ['Portugal', 'Brazil'],
        placeholder: 'Pick one',
        group: { key: 'g1', label: 'Address', index: 0 },
        error: 'Required',
      }),
    ];
    const { mapper, sentMessage } = createMapper({
      decisions: [wire('country', { value: 'Portugal' })],
    });
    await mapper.map({ fields, resume: RESUME, jobDescription: 'Senior engineer' }, CREDENTIALS);

    expect(sentMessage(0)).toEqual({
      fields: [
        {
          id: 'country',
          type: 'select',
          label: 'country',
          required: false,
          currentValue: '',
          options: ['Portugal', 'Brazil'],
          placeholder: 'Pick one',
          group: { label: 'Address', index: 0 },
          error: 'Required',
        },
      ],
      resume: RESUME,
      jobDescription: 'Senior engineer',
    });
  });

  it('rewrites option values to the exact text of the option', async () => {
    const fields = [
      field('country', { type: 'select', options: ['Portugal', 'São Tomé'] }),
      field('langs', { type: 'select', options: ['English', 'Portuguese'] }),
    ];
    const { mapper } = createMapper({
      decisions: [
        wire('country', { value: 'sao tome' }),
        wire('langs', { value: ['portuguese', 'ENGLISH'] }),
      ],
    });
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions.map((decision) => decision.value)).toEqual([
      'São Tomé',
      ['Portuguese', 'English'],
    ]);
  });

  it('marks generated free text for review and clamps confidence', async () => {
    const fields = [field('cover', { type: 'textarea' }), field('remote', { type: 'checkbox' })];
    const { mapper } = createMapper({
      decisions: [
        wire('cover', { value: 'Dear team…', confidence: 7 }),
        wire('remote', { value: true, confidence: -1 }),
      ],
    });

    expect(await mapper.map({ fields, resume: RESUME }, CREDENTIALS)).toEqual([
      {
        fieldId: 'cover',
        action: 'fill',
        value: 'Dear team…',
        confidence: 1,
        origin: 'llm',
        reason: 'From the resume.',
        needsReview: true,
      },
      {
        fieldId: 'remote',
        action: 'fill',
        value: true,
        confidence: 0,
        origin: 'llm',
        reason: 'From the resume.',
      },
    ]);
  });

  it('asks again once, with feedback, when a value is not usable', async () => {
    const fields = [field('country', { type: 'select', options: ['Portugal', 'Brazil'] })];
    const { mapper, completeJson, sentMessage } = createMapper(
      { decisions: [wire('country', { value: 'PT' })] },
      { decisions: [wire('country', { value: 'Portugal' })] },
    );
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions[0]).toMatchObject({ action: 'fill', value: 'Portugal' });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(sentMessage(0)).not.toHaveProperty('feedback');
    expect(sentMessage(1).feedback).toEqual([
      'Field country ("country"): "PT" is not one of the options',
    ]);
  });

  it.each([
    ['an option that does not exist', { type: 'select', options: ['A', 'B'] }, 'C'],
    ['text for a checkbox', { type: 'checkbox' }, 'yes'],
    ['a boolean for a text field', { type: 'text' }, true],
    ['a list for a text field', { type: 'text' }, ['a', 'b']],
    ['an empty string', { type: 'text' }, '   '],
    ['no value at all', { type: 'text' }, null],
  ] as const)(
    'never fills with %s: after the retry it asks the user',
    async (_, overrides, value) => {
      const fields = [field('target', overrides as Partial<FieldSchema>), field('other')];
      const bad = { decisions: [wire('target', { value }), wire('other')] };
      const { mapper, completeJson } = createMapper(bad, bad);
      const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

      expect(completeJson).toHaveBeenCalledTimes(2);
      expect(decisions[0]).toMatchObject({ fieldId: 'target', action: 'ask_user', confidence: 0 });
      expect(decisions[0]).not.toHaveProperty('value');
      expect(decisions[1]).toMatchObject({ fieldId: 'other', action: 'fill', value: 'x' });
    },
  );

  it('asks the user about fields the model left out and ignores fields it made up', async () => {
    const fields = [field('name'), field('phone')];
    const answer = { decisions: [wire('name'), wire('invented')] };
    const { mapper } = createMapper(answer, answer);
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions.map((decision) => [decision.fieldId, decision.action])).toEqual([
      ['name', 'fill'],
      ['phone', 'ask_user'],
    ]);
  });

  it('retries once when the answer is malformed, then accepts a good one', async () => {
    const { mapper, sentMessage } = createMapper(
      { decisions: [{ fieldId: 'name', action: 'type_it', confidence: 'high' }] },
      { decisions: [wire('name')] },
    );
    const decisions = await mapper.map({ fields: [field('name')], resume: RESUME }, CREDENTIALS);

    expect(decisions[0]?.action).toBe('fill');
    expect(sentMessage(1).feedback).toEqual([
      'The answer did not follow the required JSON format.',
    ]);
  });

  it('fails when the answer is malformed twice', async () => {
    const { mapper, completeJson } = createMapper({ nope: true }, 'still not it');
    const result = mapper.map({ fields: [field('name')], resume: RESUME }, CREDENTIALS);

    await expect(result).rejects.toBeInstanceOf(LlmError);
    await expect(result).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

  it('keeps the usable first answer when the retry comes back malformed', async () => {
    const fields = [field('name'), field('country', { type: 'select', options: ['Portugal'] })];
    const { mapper } = createMapper(
      { decisions: [wire('name', { value: 'Ana' }), wire('country', { value: 'Spain' })] },
      { broken: true },
    );
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions.map((decision) => decision.action)).toEqual(['fill', 'ask_user']);
  });

  it('keeps where a filled value came from, and drops empty sources', async () => {
    const fields = [field('email'), field('years')];
    const { mapper } = createMapper({
      decisions: [wire('email', { source: 'basics.email' }), wire('years', { source: null })],
    });
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions[0]?.source).toBe('basics.email');
    expect(decisions[1]).not.toHaveProperty('source');
  });

  it('offers stored answers to the model without their bookkeeping', async () => {
    const answers = [{ id: 'a1', question: 'Notice period', answer: '60 days', updatedAt: 123 }];
    const { mapper, sentMessage } = createMapper({ decisions: [wire('notice')] });
    await mapper.map({ fields: [field('notice')], resume: RESUME, answers }, CREDENTIALS);

    expect(sentMessage(0).answers).toEqual([
      { id: 'a1', question: 'Notice period', answer: '60 days' },
    ]);
  });

  it('only accepts the resume marker for upload fields', async () => {
    const fields = [field('cv', { type: 'file' }), field('letter', { type: 'file' })];
    const answer = {
      decisions: [wire('cv', { value: 'resume' }), wire('letter', { value: 'cover-letter.pdf' })],
    };
    const { mapper } = createMapper(answer, answer);
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions.map((decision) => [decision.action, decision.value])).toEqual([
      ['fill', 'resume'],
      ['ask_user', undefined],
    ]);
  });

  it.each([
    'I agree to the terms and conditions',
    'Li e aceito a política de privacidade',
    'Autorizo o tratamento dos meus dados (RGPD)',
    'Ich stimme der Datenschutzerklärung zu',
    "J'accepte les conditions",
  ])('never ticks the consent box "%s" for the applicant', async (label) => {
    const fields = [
      field('consent', { type: 'checkbox', label }),
      field('remote', { type: 'checkbox', label: 'Open to remote work' }),
    ];
    const answer = {
      decisions: [wire('consent', { value: true }), wire('remote', { value: true })],
    };
    const { mapper } = createMapper(answer, answer);
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions[0]).toMatchObject({ fieldId: 'consent', action: 'ask_user' });
    expect(decisions[1]).toMatchObject({ fieldId: 'remote', action: 'fill', value: true });
  });

  it('lets the model leave a consent box unticked', async () => {
    const fields = [field('consent', { type: 'checkbox', label: 'I agree to the terms' })];
    const { mapper, completeJson } = createMapper({
      decisions: [wire('consent', { value: false })],
    });
    const decisions = await mapper.map({ fields, resume: RESUME }, CREDENTIALS);

    expect(decisions[0]).toMatchObject({ action: 'fill', value: false });
    expect(completeJson).toHaveBeenCalledOnce();
  });

  describe('chooseAdvanceButton', () => {
    const buttons = ['Back', 'Onward'].map((text) => ({
      frameId: 0,
      selector: `#${text}`,
      text,
      kind: 'other' as const,
      disabled: false,
    }));

    it('returns the button the model points at, sending only the texts', async () => {
      const { mapper, sentMessage } = createMapper({ index: 1 });
      expect(await mapper.chooseAdvanceButton(buttons, CREDENTIALS)).toBe(buttons[1]);
      expect(sentMessage(0)).toEqual({ buttons: ['Back', 'Onward'] });
    });

    it.each([
      ['no button', { index: null }],
      ['an index out of range', { index: 9 }],
      ['a malformed answer', { index: 'second' }],
    ])('returns nothing when the model gives %s', async (_, answer) => {
      const { mapper } = createMapper(answer);
      expect(await mapper.chooseAdvanceButton(buttons, CREDENTIALS)).toBeNull();
    });
  });

  it('lets client errors through untouched', async () => {
    const completeJson = vi.fn().mockRejectedValue(new LlmError('auth', 'bad key'));
    const mapper = new Mapper({ completeJson });
    await expect(
      mapper.map({ fields: [field('name')], resume: RESUME }, CREDENTIALS),
    ).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});
