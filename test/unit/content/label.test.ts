import { describe, expect, it } from 'vitest';
import { resolveLabel } from '../../../src/content/extractor/label';
import { render } from './helpers';

function labelOf(selector: string) {
  const control = document.querySelector(selector);
  if (!control) throw new Error(`Missing ${selector}`);
  return resolveLabel(control);
}

describe('resolveLabel', () => {
  it('uses <label for>', () => {
    render('<label for="email">Email address</label><input id="email" />');
    expect(labelOf('#email')).toMatchObject({ text: 'Email address', source: 'label-for' });
  });

  it('uses a wrapping label, ignoring the text of the control itself', () => {
    render(`
      <label>Country
        <select id="country"><option>Portugal</option><option>Brazil</option></select>
      </label>`);
    expect(labelOf('#country')).toMatchObject({ text: 'Country', source: 'label-wrap' });
  });

  it('uses aria-labelledby, joining every referenced element', () => {
    render(`
      <span id="section">Experience</span><span id="what">Job title</span>
      <input id="title" aria-labelledby="section what missing" />`);
    expect(labelOf('#title')).toMatchObject({
      text: 'Experience Job title',
      source: 'aria-labelledby',
    });
  });

  it('uses aria-label', () => {
    render('<input id="phone" aria-label="Phone number" />');
    expect(labelOf('#phone')).toMatchObject({ text: 'Phone number', source: 'aria-label' });
  });

  it('uses the placeholder', () => {
    render('<input id="city" placeholder="City" />');
    expect(labelOf('#city')).toMatchObject({ text: 'City', source: 'placeholder' });
  });

  it('uses the closest preceding text', () => {
    render(`
      <div><div class="caption">First name</div><div><input id="first" /></div></div>
      <div><div class="caption">Last name</div><div><input id="last" /></div></div>`);
    expect(labelOf('#first')).toMatchObject({ text: 'First name', source: 'nearby-text' });
    expect(labelOf('#last')).toMatchObject({ text: 'Last name', source: 'nearby-text' });
  });

  it('does not borrow the text of a neighbouring control as nearby text', () => {
    render('<form><button>Upload</button><input class="lonely" /></form>');
    expect(labelOf('.lonely')).toBeNull();
  });

  it('falls back to a readable version of the name attribute', () => {
    render('<form><input id="x" name="applicant[postalCode]" /></form>');
    expect(labelOf('#x')).toMatchObject({
      text: 'applicant postal code',
      source: 'name-attribute',
    });
  });

  it('prefers nearby text over a placeholder that only shows a format', () => {
    render(`
      <div><div>Data de Início *</div><div><input id="start" placeholder="dd-mm-aaaa" /></div></div>
      <input id="alone" placeholder="dd-mm-aaaa" />`);
    expect(labelOf('#start')).toMatchObject({
      text: 'Data de Início',
      source: 'nearby-text',
      hasRequiredMark: true,
    });
    expect(labelOf('#alone')).toMatchObject({ text: 'dd-mm-aaaa', source: 'placeholder' });
  });

  it('does not take the label of the field before it for its own', () => {
    render(`
      <div class="row"><span>Company</span><input id="company" /></div>
      <div class="row"><input id="unnamed" /></div>
      <div class="row"><span>Phone</span><select><option>+351</option></select><input id="phone" /></div>`);
    expect(labelOf('#unnamed')?.source).toBe('name-attribute');
    expect(labelOf('#phone')).toMatchObject({ text: 'Phone', source: 'nearby-text' });
  });

  it('prefers a label that sits beside the control, even unwired, over an example placeholder', () => {
    render(`
      <div class="form-group">
        <div class="label-wrapper"><label for="occupationOrPosition">Ocupação ou posição atual</label></div>
        <input id="occupationOrPositionHeld" placeholder="Título da Ocupação" />
      </div>
      <div class="form-group"><label>Empresa</label><input id="company" placeholder="Por exemplo, uma empresa" /></div>`);
    expect(labelOf('#occupationOrPositionHeld')).toMatchObject({
      text: 'Ocupação ou posição atual',
      source: 'nearby-text',
    });
    expect(labelOf('#company')?.text).toBe('Empresa');
  });

  it('keeps the placeholder over loose text, or over a label wired to another control', () => {
    render(`
      <h2>Contact</h2><input id="first" placeholder="First name" />
      <div><label for="other">Other field</label><input id="mine" placeholder="Mine" /></div>
      <input id="other" />`);
    expect(labelOf('#first')).toMatchObject({ text: 'First name', source: 'placeholder' });
    expect(labelOf('#mine')).toMatchObject({ text: 'Mine', source: 'placeholder' });
  });

  it('prefers sources in order of reliability', () => {
    render(`
      <label for="a">From label</label>
      <input id="a" aria-label="From aria" placeholder="From placeholder" />`);
    expect(labelOf('#a')?.source).toBe('label-for');
  });

  it('strips the required asterisk and trailing colon but remembers the mark', () => {
    render('<label for="name">Full name *:</label><input id="name" />');
    expect(labelOf('#name')).toMatchObject({ text: 'Full name', hasRequiredMark: true });
  });

  it('drops a "Required" written into the label for screen readers, keeping it as a mark', () => {
    render(`
      <label for="a">Email<sup aria-hidden="true">*</sup><span class="sr-only">Required</span></label><input id="a" />
      <label for="b"><span class="sr-only">Required.</span>By submitting this application, I agree</label><input id="b" type="checkbox" />
      <label for="c">Telefone (obrigatório)</label><input id="c" />
      <label for="d">Required skills</label><input id="d" />`);
    expect(labelOf('#a')).toMatchObject({ text: 'Email', hasRequiredMark: true });
    expect(labelOf('#b')).toMatchObject({
      text: 'By submitting this application, I agree',
      hasRequiredMark: true,
    });
    expect(labelOf('#c')).toMatchObject({ text: 'Telefone', hasRequiredMark: true });
    expect(labelOf('#d')).toMatchObject({ text: 'Required skills', hasRequiredMark: false });
  });

  it('skips empty sources', () => {
    render('<label for="a">  </label><input id="a" aria-label="" placeholder="Real one" />');
    expect(labelOf('#a')).toMatchObject({ text: 'Real one', source: 'placeholder' });
  });
});
