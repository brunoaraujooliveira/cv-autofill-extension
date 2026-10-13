import { describe, expect, it } from 'vitest';
import {
  BUSY_PHASES,
  canTransition,
  InvalidTransitionError,
  transition,
  type RunEvent,
} from '../../../src/shared/run-machine';
import {
  fieldKey,
  hasAdvanceButton,
  isEmptyValue,
  isFinalStep,
  stepSignature,
} from '../../../src/shared/step';
import type { ButtonInfo, FieldSchema, RunPhase, StepSchema } from '../../../src/shared/types';

const ALL_EVENTS: RunEvent[] = [
  'START',
  'FIELDS_FOUND',
  'NOTHING_TO_FILL',
  'MAPPED',
  'FILLED',
  'NEEDS_ANOTHER_ROUND',
  'STEP_READY',
  'FINAL_STEP',
  'CONFIRM',
  'STEP_CHANGED',
  'RECHECK',
  'STUCK',
  'FINISH',
  'CANCEL',
  'FAIL',
];
const ALL_PHASES: RunPhase[] = [
  'IDLE',
  'EXTRACTING',
  'MAPPING',
  'FILLING',
  'VALIDATING',
  'WAITING_USER_REVIEW',
  'ADVANCING',
  'FINAL_REVIEW',
  'DONE',
  'ERROR',
];

function walk(start: RunPhase, events: RunEvent[]): RunPhase {
  return events.reduce(transition, start);
}

describe('run state machine', () => {
  it('follows the path of a step: read, decide, fill, check, wait', () => {
    expect(walk('IDLE', ['START', 'FIELDS_FOUND', 'MAPPED', 'FILLED', 'STEP_READY'])).toBe(
      'WAITING_USER_REVIEW',
    );
  });

  it('loops back to deciding when the check finds more to do', () => {
    expect(walk('VALIDATING', ['NEEDS_ANOTHER_ROUND', 'MAPPED', 'FILLED'])).toBe('VALIDATING');
  });

  it('moves to the next step only through the user confirming', () => {
    expect(walk('WAITING_USER_REVIEW', ['CONFIRM', 'STEP_CHANGED'])).toBe('EXTRACTING');
    const waysIntoAdvancing = ALL_PHASES.flatMap((phase) =>
      ALL_EVENTS.filter(
        (event) => canTransition(phase, event) && transition(phase, event) === 'ADVANCING',
      ).map((event) => `${phase}+${event}`),
    );
    expect(waysIntoAdvancing).toEqual(['WAITING_USER_REVIEW+CONFIRM']);
  });

  it('ends at the final review, from which nothing leads to advancing', () => {
    expect(transition('VALIDATING', 'FINAL_STEP')).toBe('FINAL_REVIEW');
    expect(transition('EXTRACTING', 'FINAL_STEP')).toBe('FINAL_REVIEW');
    expect(transition('ADVANCING', 'FINAL_STEP')).toBe('FINAL_REVIEW');
    expect(canTransition('FINAL_REVIEW', 'CONFIRM')).toBe(false);
    expect(ALL_EVENTS.filter((event) => canTransition('FINAL_REVIEW', event))).toEqual([
      'START',
      'FINISH',
    ]);
    expect(transition('FINAL_REVIEW', 'FINISH')).toBe('DONE');
  });

  it('handles a step that does not move', () => {
    expect(walk('ADVANCING', ['RECHECK'])).toBe('EXTRACTING');
    expect(walk('ADVANCING', ['STUCK'])).toBe('WAITING_USER_REVIEW');
  });

  it('can be stopped from any working phase, landing on the user review', () => {
    for (const phase of BUSY_PHASES)
      expect(transition(phase, 'CANCEL')).toBe('WAITING_USER_REVIEW');
    expect(canTransition('FINAL_REVIEW', 'CANCEL')).toBe(false);
  });

  it('treats a step the page presents as its last one as final, whatever its buttons say', () => {
    const looksFinal: StepSchema = {
      signature: 's',
      url: 'https://jobs.example.com',
      fields: [],
      buttons: [
        { frameId: 0, selector: '#go', text: 'Continue', kind: 'advance', disabled: false },
      ],
      repeatables: [],
      blockedOrigins: [],
      looksFinal: true,
    };
    expect(isFinalStep(looksFinal)).toBe(true);
    expect(isFinalStep({ ...looksFinal, looksFinal: false })).toBe(false);
  });

  it('can fail from any working phase and be started again', () => {
    for (const phase of BUSY_PHASES) expect(transition(phase, 'FAIL')).toBe('ERROR');
    for (const phase of ['ERROR', 'DONE', 'FINAL_REVIEW', 'WAITING_USER_REVIEW', 'IDLE'] as const) {
      expect(transition(phase, 'START')).toBe('EXTRACTING');
    }
  });

  it.each([
    ['IDLE', 'CONFIRM'],
    ['MAPPING', 'CONFIRM'],
    ['FILLING', 'STEP_CHANGED'],
    ['WAITING_USER_REVIEW', 'FINISH'],
    ['DONE', 'CONFIRM'],
    ['EXTRACTING', 'START'],
  ] as const)('rejects %s + %s', (phase, event) => {
    expect(canTransition(phase, event)).toBe(false);
    expect(() => transition(phase, event)).toThrow(InvalidTransitionError);
  });
});

describe('step helpers', () => {
  const button = (kind: ButtonInfo['kind']): ButtonInfo => ({
    frameId: 0,
    selector: `#${kind}`,
    text: kind,
    kind,
    disabled: false,
  });
  const step = (...kinds: ButtonInfo['kind'][]): StepSchema => ({
    signature: 's',
    url: 'https://jobs.example.com',
    fields: [],
    buttons: kinds.map(button),
    repeatables: [],
    blockedOrigins: [],
    looksFinal: false,
  });
  const field = (overrides: Partial<FieldSchema>): FieldSchema => ({
    id: 'f',
    frameId: 0,
    origin: '',
    selector: '#f',
    type: 'text',
    label: 'Name',
    labelSource: 'label-for',
    required: false,
    value: '',
    ...overrides,
  });

  it('calls a step final only when Submit is the sole way forward', () => {
    expect(isFinalStep(step('other', 'submit'))).toBe(true);
    expect(isFinalStep(step('advance', 'submit'))).toBe(false);
    expect(isFinalStep(step('other'))).toBe(false);
    expect(hasAdvanceButton(step('advance'))).toBe(true);
  });

  it('knows an empty value for every field type', () => {
    expect([isEmptyValue(''), isEmptyValue(false), isEmptyValue([])]).toEqual([true, true, true]);
    expect([isEmptyValue('x'), isEmptyValue(true), isEmptyValue(['a'])]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('keys a field by type, label and position in its section', () => {
    expect(fieldKey(field({}))).toBe('text|Name|');
    expect(fieldKey(field({ group: { key: 'g', label: 'Experience 2', index: 1 } }))).toBe(
      'text|Name|1',
    );
  });

  it('signs a step by its questions and title, not by values or order', () => {
    const name = field({ value: 'Ana' });
    const email = field({ id: 'e', label: 'Email', type: 'email' });
    expect(stepSignature([name, email])).toBe(stepSignature([email, { ...name, value: 'Bea' }]));
    expect(stepSignature([name])).not.toBe(stepSignature([email]));
    expect(stepSignature([name], 'Contact')).not.toBe(stepSignature([name], 'Review'));
  });
});
