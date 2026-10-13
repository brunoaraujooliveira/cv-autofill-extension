import { describe, expect, it } from 'vitest';
import type { RunState } from '../../../src/shared/types';
import { buildDiagnostics } from '../../../src/sidepanel/diagnostics';

const run: RunState = {
  tabId: 1,
  key: 'jobs.example.com/apply',
  phase: 'ERROR',
  stepNumber: 2,
  error: { code: 'unexpected', detail: 'boom' },
  decisions: [{ fieldId: 'f1', action: 'ask_user', confidence: 0 }],
  results: [],
  decided: {},
  attempts: { f1: 1 },
  added: { '#add': 2 },
  updatedAt: 0,
  step: {
    signature: 's',
    url: 'https://jobs.example.com/apply',
    title: 'Education',
    buttons: [],
    repeatables: [],
    blockedOrigins: ['https://forms.example'],
    looksFinal: false,
    fields: [
      {
        id: 'f1',
        frameId: 0,
        origin: 'https://jobs.example.com',
        selector: '#country',
        type: 'select',
        label: 'Country',
        labelSource: 'label-for',
        required: true,
        value: '',
        options: Array.from({ length: 40 }, (_, index) => `Country ${index}`),
      },
    ],
  },
};

describe('buildDiagnostics', () => {
  it('describes the run with what is needed to investigate it', () => {
    const report = JSON.parse(buildDiagnostics(run, '0.1.0')) as Record<string, unknown>;
    expect(report).toMatchObject({
      version: '0.1.0',
      phase: 'ERROR',
      stepNumber: 2,
      error: { code: 'unexpected', detail: 'boom' },
      step: { title: 'Education', blockedOrigins: ['https://forms.example'] },
      decisions: [{ fieldId: 'f1', action: 'ask_user' }],
      attempts: { f1: 1 },
      added: { '#add': 2 },
    });
  });

  it('shortens long option lists but says how long they were', () => {
    const report = JSON.parse(buildDiagnostics(run, '0.1.0')) as {
      step: { fields: { options: string[]; optionCount: number; selector: string }[] };
    };
    expect(report.step.fields[0]).toMatchObject({ optionCount: 40, selector: '#country' });
    expect(report.step.fields[0]?.options).toHaveLength(15);
  });

  it('leaves out what went into the form and the query of the address unless asked', () => {
    if (!run.step) throw new Error('The sample run has a step');
    const filled: RunState = {
      ...run,
      decisions: [{ fieldId: 'f1', action: 'fill', value: 'Portugal', confidence: 1 }],
      step: {
        ...run.step,
        url: 'https://jobs.example.com/apply?token=secret#me',
        fields: run.step.fields.map((field) => ({ ...field, value: 'Portugal' })),
      },
    };
    const redacted = buildDiagnostics(filled, '0.1.0');
    expect(redacted).not.toContain('Portugal"');
    expect(redacted).not.toContain('secret');
    expect(JSON.parse(redacted)).toMatchObject({
      step: { url: 'https://jobs.example.com/apply', fields: [{ value: '<8 characters>' }] },
      decisions: [{ value: '<8 characters>' }],
    });

    const full = JSON.parse(buildDiagnostics(filled, '0.1.0', { includeValues: true })) as unknown;
    expect(full).toMatchObject({
      step: {
        url: 'https://jobs.example.com/apply?token=secret#me',
        fields: [{ value: 'Portugal' }],
      },
      decisions: [{ value: 'Portugal' }],
    });
  });

  it('works before any step was read', () => {
    const { step: _step, error: _error, ...idle } = run;
    expect(JSON.parse(buildDiagnostics(idle, '0.1.0'))).not.toHaveProperty('step');
  });
});
