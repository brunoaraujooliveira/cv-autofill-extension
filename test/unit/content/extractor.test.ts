import { describe, expect, it, vi } from 'vitest';
import { buildDeepSelector, buildSelector } from '../../../src/content/extractor/selector';
import { byLabel, extract, render } from './helpers';

describe('extractFields', () => {
  it('describes the basic input types', async () => {
    render(`
      <form>
        <label for="name">Full name *</label><input id="name" required value="Ana" />
        <label for="email">Email</label><input id="email" type="email" />
        <label for="phone">Phone</label><input id="phone" type="tel" placeholder="+351 000 000 000" />
        <label for="years">Years</label><input id="years" type="number" />
        <label for="start">Start</label><input id="start" type="date" />
        <label for="about">About you</label><textarea id="about"></textarea>
        <label for="cv">Resume</label><input id="cv" type="file" />
      </form>`);
    const fields = await extract();

    expect(fields.map((field) => [field.schema.label, field.schema.type])).toEqual([
      ['Full name', 'text'],
      ['Email', 'email'],
      ['Phone', 'tel'],
      ['Years', 'number'],
      ['Start', 'date'],
      ['About you', 'textarea'],
      ['Resume', 'file'],
    ]);
    expect(byLabel(fields, 'Full name').schema).toMatchObject({
      required: true,
      value: 'Ana',
      selector: '#name',
      frameId: 0,
      labelSource: 'label-for',
    });
    expect(byLabel(fields, 'Phone').schema.placeholder).toBe('+351 000 000 000');
    expect(byLabel(fields, 'Start').schema.placeholder).toBe('YYYY-MM-DD');
    expect(byLabel(fields, 'Email').schema.required).toBe(false);
  });

  it('never returns passwords, hidden inputs, buttons, disabled or read-only controls', async () => {
    render(`
      <input aria-label="Password" type="password" />
      <input aria-label="Token" type="hidden" />
      <input aria-label="Go" type="submit" />
      <input aria-label="Disabled" disabled />
      <input aria-label="Read only" readonly />
      <fieldset disabled><input aria-label="In disabled fieldset" /></fieldset>
      <input aria-label="Aria disabled" aria-disabled="true" />
      <input aria-label="Kept" />`);
    expect((await extract()).map((field) => field.schema.label)).toEqual(['Kept']);
  });

  it('skips invisible fields', async () => {
    render(`
      <div style="display:none"><input aria-label="Hidden step" /></div>
      <div role="tabpanel" hidden><input aria-label="Other tab" /></div>
      <input aria-label="Shown" />`);
    expect((await extract()).map((field) => field.schema.label)).toEqual(['Shown']);
  });

  it('skips fields the user cannot see, whatever they are labelled', async () => {
    render(`
      <label for="salary">Expected salary</label><input id="salary" style="opacity:0" />
      <div style="opacity:0"><label for="visa">Visa status</label><input id="visa" /></div>
      <label for="shown">Shown</label><input id="shown" />`);
    expect((await extract()).map((field) => field.schema.label)).toEqual(['Shown']);
  });

  it('takes an upload hidden behind its label only when that label is visible', async () => {
    render(`
      <label for="cv">Upload your resume</label><input id="cv" type="file" style="display:none" />
      <label for="trap" style="opacity:0">Resume</label><input id="trap" type="file" style="display:none" />`);
    expect((await extract()).map((field) => field.schema.label)).toEqual(['Upload your resume']);
  });

  it('reads select options by their text and leaves out the empty placeholder option', async () => {
    render(`
      <label for="country">Country</label>
      <select id="country" aria-required="true">
        <option value="">Select…</option>
        <option value="PT" selected>Portugal</option>
        <option value="BR">Brazil</option>
        <option value="XX" disabled>Unavailable</option>
      </select>
      <label for="langs">Languages</label>
      <select id="langs" multiple>
        <option selected>English</option><option selected>Portuguese</option><option>Spanish</option>
      </select>`);
    const fields = await extract();

    expect(byLabel(fields, 'Country').schema).toMatchObject({
      type: 'select',
      required: true,
      options: ['Portugal', 'Brazil'],
      value: 'Portugal',
    });
    expect(byLabel(fields, 'Languages').schema.value).toEqual(['English', 'Portuguese']);
  });

  it('merges a radio group into one field labelled by its legend', async () => {
    render(`
      <fieldset>
        <legend>Are you authorized to work in the EU? *</legend>
        <label><input type="radio" name="auth" value="y" /> Yes</label>
        <label><input type="radio" name="auth" value="n" checked /> No</label>
      </fieldset>`);
    const [field, ...rest] = await extract();

    expect(rest).toEqual([]);
    expect(field?.schema).toMatchObject({
      type: 'radio',
      label: 'Are you authorized to work in the EU?',
      labelSource: 'group-legend',
      required: true,
      options: ['Yes', 'No'],
      value: 'No',
    });
    expect(field?.elements).toHaveLength(2);
  });

  it('labels a radio group without a fieldset from the text before it', async () => {
    render(`
      <div>
        <p>Willing to relocate?</p>
        <div>
          <label><input type="radio" name="relocate" /> Yes</label>
          <label><input type="radio" name="relocate" /> No</label>
        </div>
      </div>`);
    const [field] = await extract();
    expect(field?.schema).toMatchObject({ label: 'Willing to relocate?', value: '' });
  });

  it('keeps radio groups with the same name in different forms apart', async () => {
    render(`
      <form id="a"><label><input type="radio" name="choice" /> One</label></form>
      <form id="b"><label><input type="radio" name="choice" /> Two</label></form>`);
    expect(await extract()).toHaveLength(2);
  });

  it('describes checkboxes as booleans, also when only their label is visible', async () => {
    render(`
      <label><input type="checkbox" id="terms" checked /> I accept the terms</label>
      <label for="news">Newsletter</label><input type="checkbox" id="news" style="display:none" />`);
    const fields = await extract();
    expect(byLabel(fields, 'I accept the terms').schema).toMatchObject({
      type: 'checkbox',
      value: true,
    });
    expect(byLabel(fields, 'Newsletter').schema.value).toBe(false);
  });

  it('assigns repeated sections consecutive group indexes', async () => {
    render(`
      <fieldset><legend>Experience 1</legend><input aria-label="Company" /></fieldset>
      <fieldset><legend>Experience 2</legend><input aria-label="Company" /></fieldset>
      <section><h2>Education</h2><input aria-label="School" /></section>
      <input aria-label="Loose" />`);
    const fields = await extract();

    expect(fields.map((field) => field.schema.group)).toEqual([
      { key: expect.any(String) as string, label: 'Experience 1', index: 0 },
      { key: expect.any(String) as string, label: 'Experience 2', index: 1 },
      { key: expect.any(String) as string, label: 'Education', index: 0 },
      undefined,
    ]);
    expect(new Set(fields.map((field) => field.schema.id)).size).toBe(4);
  });

  it('puts a radio group inside the section that contains its fieldset', async () => {
    render(`
      <section><h3>Eligibility</h3>
        <fieldset><legend>Over 18?</legend>
          <label><input type="radio" name="adult" /> Yes</label>
        </fieldset>
      </section>`);
    const [field] = await extract();
    expect(field?.schema.group?.label).toBe('Eligibility');
  });

  it('detects custom comboboxes and reads options already in the page', async () => {
    render(`
      <label id="lbl">Seniority</label>
      <div role="combobox" id="seniority" aria-labelledby="lbl" aria-controls="list" tabindex="0">
        <input type="text" />
      </div>
      <ul role="listbox" id="list"><li role="option">Junior</li><li role="option">Senior</li></ul>`);
    const fields = await extract();

    expect(fields).toHaveLength(1);
    expect(fields[0]?.schema).toMatchObject({
      type: 'combobox',
      label: 'Seniority',
      options: ['Junior', 'Senior'],
    });
  });

  it('opens a combobox to read its options only when none are in the page', async () => {
    render('<input role="combobox" aria-label="City" value="Lisbon" />');
    const harvestOptions = vi.fn().mockResolvedValue(['Lisbon', 'Porto']);
    const [field] = await extract({ harvestOptions });

    expect(harvestOptions).toHaveBeenCalledOnce();
    expect(field?.schema).toMatchObject({
      type: 'combobox',
      value: 'Lisbon',
      options: ['Lisbon', 'Porto'],
    });
  });

  it('gives fields stable ids across extractions and unique ids within one', async () => {
    render(`
      <div><input aria-label="Company" /></div>
      <div><input aria-label="Company" /></div>`);
    const first = (await extract()).map((field) => field.schema.id);
    const second = (await extract()).map((field) => field.schema.id);

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });
});

describe('extractFields beyond plain documents', () => {
  function mountShadowForm(): ShadowRoot {
    render('<section><h2>Profile</h2><div id="host"></div></section>');
    const outer = (document.querySelector('#host') as HTMLElement).attachShadow({ mode: 'open' });
    outer.innerHTML =
      '<label for="first">First name</label><input id="first" /><div id="inner"></div>';
    const inner = (outer.querySelector('#inner') as HTMLElement).attachShadow({ mode: 'open' });
    inner.innerHTML = '<label>Email <input type="email" /></label>';
    return outer;
  }

  it('finds fields inside nested open shadow roots, labelled within their own root', async () => {
    mountShadowForm();
    const fields = await extract();

    expect(fields.map((field) => [field.schema.label, field.schema.type])).toEqual([
      ['First name', 'text'],
      ['Email', 'email'],
    ]);
    expect(fields[0]?.schema.selector).toBe('#host >>> #first');
    expect(fields[1]?.schema.selector).toBe('#host >>> #inner >>> label > input');
  });

  it('builds the same deep selector for a shadow element as the extractor reports', () => {
    const outer = mountShadowForm();
    const first = outer.querySelector('#first') as Element;
    expect(buildDeepSelector(first)).toBe('#host >>> #first');
    expect(buildDeepSelector(document.querySelector('#host') as Element)).toBe('#host');
  });

  it('stamps every field with the frame it was read from', async () => {
    render('<input aria-label="Email" />');
    const [top] = await extract();
    const [framed] = await extract({ frameId: 7 });

    expect(framed?.schema.frameId).toBe(7);
    expect(framed?.schema.id).not.toBe(top?.schema.id);
  });

  it('reports the validation message the page shows for a field', async () => {
    render(`
      <div><label for="birth">Date of birth</label>
        <input id="birth" aria-invalid="true" aria-describedby="birth-error" value="1991-08-20" />
        <span id="birth-error">Use the format DD/MM/YYYY</span></div>
      <div><label for="name">Name</label><input id="name" value="Ana" /></div>`);
    const fields = await extract();

    expect(byLabel(fields, 'Date of birth').schema.error).toBe('Use the format DD/MM/YYYY');
    expect(byLabel(fields, 'Name').schema).not.toHaveProperty('error');
  });

  it('numbers fields that repeat a label outside any labelled section', async () => {
    render(`
      <div><input aria-label="Company" /><input aria-label="Job title" /></div>
      <div><input aria-label="Company" /><input aria-label="Job title" /></div>
      <input aria-label="Email" />`);
    const fields = await extract();

    expect(fields.map((field) => field.schema.group?.index)).toEqual([0, 0, 1, 1, undefined]);
    expect(fields[2]?.schema.group).toEqual({ key: 'entry-1', label: 'Entry 2', index: 1 });
  });
});

describe('buildSelector', () => {
  const selectorOf = (query: string) => {
    const element = document.querySelector(query);
    if (!element) throw new Error(`Missing ${query}`);
    return buildSelector(element);
  };

  it('prefers a unique id, then stable attributes', () => {
    render(`
      <input id="unique" />
      <input data-automation-id="legalName" />
      <input name="email" />`);
    expect(selectorOf('#unique')).toBe('#unique');
    expect(selectorOf('[data-automation-id]')).toBe('input[data-automation-id="legalName"]');
    expect(selectorOf('[name="email"]')).toBe('input[name="email"]');
  });

  it('builds a positional path from the nearest identifiable ancestor', () => {
    render(`
      <div id="experience">
        <div><input class="first" /><input class="second" /></div>
      </div>`);
    const selector = selectorOf('.second');
    expect(selector).toBe('#experience > div > input:nth-of-type(2)');
    expect(document.querySelector(selector)).toBe(document.querySelector('.second'));
  });

  it('ignores ids and names that are not unique', () => {
    render('<p><input name="dup" id="dup" /></p><p><input name="dup" id="dup" class="b" /></p>');
    const selector = selectorOf('.b');
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(document.querySelector('.b'));
  });
});
