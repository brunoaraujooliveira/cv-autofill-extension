import { describe, expect, it, vi } from 'vitest';
import type { ExtractedField } from '../../../src/content/extractor';
import { fillFields } from '../../../src/content/filler';
import type { FieldDecision } from '../../../src/shared/types';
import { byLabel, extract, recordEvents, render } from './helpers';

const EVENTS = ['input', 'change', 'blur', 'focusout', 'click'];

async function setup(html: string) {
  render(html);
  const extracted = await extract();
  const fields = new Map(extracted.map((field) => [field.schema.id, field]));
  const fill = (label: string, value: NonNullable<FieldDecision['value']>) => {
    const fieldId = byLabel(extracted, label).schema.id;
    return fillFields(fields, [{ fieldId, action: 'fill', value, confidence: 1 }], { delayMs: 0 });
  };
  const element = (label: string) => byLabel(extracted, label).elements[0] as HTMLElement;
  return { extracted, fields, fill, element };
}

describe('fillFields', () => {
  it('fills text inputs through the native setter and fires input, change and blur', async () => {
    const { fill, element } = await setup('<input aria-label="Name" />');
    const input = element('Name') as HTMLInputElement;

    // Stands in for a framework that shadows the instance setter to track changes.
    const instanceSetter = vi.fn();
    Object.defineProperty(input, 'value', {
      configurable: true,
      set: instanceSetter,
      get: () =>
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(
          input,
        ) as string,
    });
    const events = recordEvents(document.body, EVENTS);

    expect(await fill('Name', 'Ana Example')).toEqual([
      { fieldId: expect.any(String) as string, status: 'filled' },
    ]);
    expect(input.value).toBe('Ana Example');
    expect(instanceSetter).not.toHaveBeenCalled();
    expect(events).toEqual(['input', 'change', 'blur', 'focusout']);
  });

  it('fills textareas', async () => {
    const { fill, element } = await setup('<textarea aria-label="About"></textarea>');
    await fill('About', 'Line one\nLine two');
    expect((element('About') as HTMLTextAreaElement).value).toBe('Line one\nLine two');
  });

  it('selects an option by its text and fires change', async () => {
    const { fill, element } = await setup(`
      <select aria-label="Country">
        <option value="">Select…</option><option value="PT">Portugal</option><option value="BR">Brazil</option>
      </select>`);
    const select = element('Country') as HTMLSelectElement;
    const events = recordEvents(select, EVENTS);

    expect((await fill('Country', 'brazil'))[0]?.status).toBe('filled');
    expect(select.value).toBe('BR');
    expect(events).toContain('change');
  });

  it('selects several options in a multiple select', async () => {
    const { fill, element } = await setup(`
      <select aria-label="Languages" multiple>
        <option selected>German</option><option>English</option><option>Portuguese</option>
      </select>`);
    await fill('Languages', ['English', 'Portuguese']);
    const selected = Array.from((element('Languages') as HTMLSelectElement).selectedOptions);
    expect(selected.map((option) => option.text)).toEqual(['English', 'Portuguese']);
  });

  it('reports a select value that is not among the options', async () => {
    const { fill } = await setup('<select aria-label="Country"><option>Portugal</option></select>');
    expect(await fill('Country', 'Spain')).toEqual([
      {
        fieldId: expect.any(String) as string,
        status: 'failed',
        error: 'No option matches "Spain"',
      },
    ]);
  });

  it('clicks the radio whose label matches', async () => {
    const { fill, extracted } = await setup(`
      <fieldset><legend>Work permit</legend>
        <label><input type="radio" name="permit" /> Yes</label>
        <label><input type="radio" name="permit" /> No</label>
      </fieldset>`);
    const radios = byLabel(extracted, 'Work permit').elements as HTMLInputElement[];
    const events = recordEvents(document.body, EVENTS);

    expect((await fill('Work permit', 'No'))[0]?.status).toBe('filled');
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    expect(events).toContain('click');
  });

  it('clicks checkboxes only when their state has to change', async () => {
    const { fill, element } = await setup(`
      <label><input type="checkbox" /> Remote</label>
      <label><input type="checkbox" checked /> Relocate</label>`);
    const clicks = recordEvents(document.body, ['click']);

    await fill('Remote', true);
    await fill('Relocate', true);
    await fill('Relocate', false);

    expect((element('Remote') as HTMLInputElement).checked).toBe(true);
    expect((element('Relocate') as HTMLInputElement).checked).toBe(false);
    expect(clicks).toHaveLength(2);
  });

  it('rejects a non-boolean value for a checkbox', async () => {
    const { fill } = await setup('<label><input type="checkbox" /> Remote</label>');
    expect((await fill('Remote', 'yes'))[0]).toMatchObject({ status: 'failed' });
  });

  it('fills native date inputs only with the format they accept', async () => {
    const { fill, element } = await setup('<input aria-label="Start" type="date" />');

    expect((await fill('Start', '03/2021'))[0]).toMatchObject({
      status: 'failed',
      error: 'Expected the format YYYY-MM-DD, got "03/2021"',
    });
    expect((await fill('Start', '2021-03-01'))[0]?.status).toBe('filled');
    expect((element('Start') as HTMLInputElement).value).toBe('2021-03-01');
  });

  it('leaves file uploads for the user', async () => {
    const { fill } = await setup('<input aria-label="Resume" type="file" />');
    expect((await fill('Resume', 'resume.pdf'))[0]?.status).toBe('pending_manual');
  });

  it('reports fields that are unknown or no longer on the page', async () => {
    const { fields, fill, element } = await setup('<input aria-label="Name" />');
    element('Name').remove();

    expect((await fill('Name', 'Ana'))[0]).toMatchObject({ status: 'failed' });
    expect(
      await fillFields(fields, [{ fieldId: 'nope', action: 'fill', value: 'x', confidence: 1 }], {
        delayMs: 0,
      }),
    ).toEqual([{ fieldId: 'nope', status: 'failed', error: 'Unknown field' }]);
  });

  it('empties typed text when asked to, leaving choices alone', async () => {
    const { fill, element } = await setup(`
      <input aria-label="Name" value="Wrong" />
      <textarea aria-label="About">Old draft</textarea>
      <div role="combobox" aria-label="Course"><input value="Typed before" /></div>
      <select aria-label="Country"><option>Portugal</option></select>
      <label><input type="checkbox" checked /> Remote</label>`);
    const events = recordEvents(element('Name'), ['input', 'change']);

    for (const label of ['Name', 'About', 'Course', 'Country', 'Remote']) {
      expect((await fill(label, ''))[0]?.status).toBe('filled');
    }

    expect((element('Name') as HTMLInputElement).value).toBe('');
    expect((element('About') as HTMLTextAreaElement).value).toBe('');
    expect(element('Course').querySelector('input')?.value).toBe('');
    expect((element('Country') as HTMLSelectElement).value).toBe('Portugal');
    expect((element('Remote') as HTMLInputElement).checked).toBe(true);
    expect(events).toEqual(['input', 'change']);
  });

  it('stops before the next field once asked to', async () => {
    render('<input aria-label="A" /><input aria-label="B" /><input aria-label="C" />');
    const extracted = await extract();
    const fields = new Map<string, ExtractedField>(extracted.map((f) => [f.schema.id, f]));
    const decisions = extracted.map((f): FieldDecision => ({
      fieldId: f.schema.id,
      action: 'fill',
      value: 'x',
      confidence: 1,
    }));
    let filled = 0;
    const results = await fillFields(fields, decisions, {
      delayMs: 0,
      shouldStop: () => filled++ >= 1,
    });

    expect(results).toHaveLength(1);
    expect(extracted.map((f) => (f.elements[0] as HTMLInputElement).value)).toEqual(['x', '', '']);
  });

  it('only acts on fill decisions and waits between fields', async () => {
    render('<input aria-label="A" /><input aria-label="B" /><input aria-label="C" />');
    const extracted = await extract();
    const fields = new Map<string, ExtractedField>(extracted.map((f) => [f.schema.id, f]));
    const id = (label: string) => byLabel(extracted, label).schema.id;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const results = await fillFields(
      fields,
      [
        { fieldId: id('A'), action: 'fill', value: 'a', confidence: 1 },
        { fieldId: id('B'), action: 'ask_user', confidence: 0 },
        { fieldId: id('C'), action: 'skip', confidence: 1 },
      ],
      { delayMs: 120, sleep },
    );

    expect(results).toEqual([{ fieldId: id('A'), status: 'filled' }]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(120);
    expect((byLabel(extracted, 'B').elements[0] as HTMLInputElement).value).toBe('');
  });
});
