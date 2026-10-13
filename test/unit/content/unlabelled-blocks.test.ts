import { describe, expect, it } from 'vitest';
import { fillFields } from '../../../src/content/filler';
import { findButtons } from '../../../src/content/navigator/buttons';
import { findRepeatables } from '../../../src/content/repeater';
import { ALWAYS_HAS_BOX, extract, render } from './helpers';

/**
 * A page shaped like a real portal: one heading for the whole step, entries listed as plain
 * sibling blocks with nothing labelling each one, "Add" buttons as siblings of the blocks,
 * free-text comboboxes, and date inputs whose only attribute is a format placeholder.
 */
const row = (label: string, control: string) =>
  `<div><div>${label}</div><div>${control}</div></div>`;
const courseBlock = `
  <div><div>
    ${row('Curso *', '<div role="combobox"><input placeholder="Título ou Qualificação" /></div>')}
    ${row('É certificação?', '<input type="checkbox" />')}
    ${row('Instituição *', '<div role="combobox"><input placeholder="Escola" /></div>')}
    ${row('Data de Início *', '<input placeholder="dd-mm-aaaa" />')}
    ${row('Data de Fim', '<input placeholder="dd-mm-aaaa" />')}
  </div></div>`;

function mountPortal(courseBlocks: number): void {
  render(`
    <form><section>
      <h2>Educação e Certificação</h2>
      <div><div>
        ${courseBlock.repeat(courseBlocks)}
        <div><button type="button" id="add-course">Adicionar outro curso e instituição</button></div>
        <div>
          ${row('Língua Materna *', '<select name="motherLanguage"><option>Português</option></select>')}
          ${row('Outro Idioma', '<select id="languageId"><option>Inglês</option></select>')}
        </div>
        <div><button type="button" id="add-language">Adicionar outro idioma</button></div>
      </div></div>
    </section></form>`);
}

describe('entries listed as unlabelled sibling blocks', () => {
  it('labels date fields by the text beside them, not by their format placeholder', async () => {
    mountPortal(1);
    const labels = (await extract()).map((field) => field.schema.label);
    expect(labels).toEqual([
      'Curso',
      'É certificação?',
      'Instituição',
      'Data de Início',
      'Data de Fim',
      'Língua Materna',
      'Outro Idioma',
    ]);
  });

  it('gives each block its own numbered group and leaves single fields in the section', async () => {
    mountPortal(3);
    const fields = await extract();
    const groupOf = (label: string) =>
      fields.filter((f) => f.schema.label === label).map((f) => f.schema.group);

    expect(groupOf('Curso').map((group) => group?.index)).toEqual([0, 1, 2]);
    expect(groupOf('Data de Fim').map((group) => group?.label)).toEqual([
      'Educação e Certificação 1',
      'Educação e Certificação 2',
      'Educação e Certificação 3',
    ]);
    expect(new Set(groupOf('Instituição').map((group) => group?.key)).size).toBe(3);
    expect(groupOf('Língua Materna')).toEqual([
      { key: expect.any(String) as string, label: 'Educação e Certificação', index: 0 },
    ]);
  });

  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
  ])(
    'counts %i course block(s) and one language block, each for its own button',
    (present, expected) => {
      mountPortal(present);
      const repeatables = findRepeatables(
        findButtons(document, { hasBox: ALWAYS_HAS_BOX }),
        ALWAYS_HAS_BOX,
      );

      expect(repeatables).toMatchObject([
        {
          text: 'Adicionar outro curso e instituição',
          kinds: ['education', 'certificates'],
          existingBlocks: expected,
        },
        { text: 'Adicionar outro idioma', kinds: ['languages'], existingBlocks: 1 },
      ]);
    },
  );

  it('types into a combobox that only suggests, and keeps the text when nothing matches', async () => {
    mountPortal(1);
    const extracted = await extract();
    const course = extracted.find((field) => field.schema.label === 'Curso');
    const fields = new Map(extracted.map((field) => [field.schema.id, field]));
    const input = course?.elements[0]?.querySelector('input');
    const events: string[] = [];
    for (const type of ['input', 'change', 'focusout']) {
      input?.addEventListener(type, () => events.push(type));
    }

    const results = await fillFields(
      fields,
      [
        {
          fieldId: course?.schema.id ?? '',
          action: 'fill',
          value: 'Information Systems',
          confidence: 1,
        },
      ],
      { delayMs: 0, combobox: { hasBox: ALWAYS_HAS_BOX, timeoutMs: 20 } },
    );

    expect(course?.schema).toMatchObject({ type: 'combobox' });
    expect(course?.schema).not.toHaveProperty('options');
    expect(results).toEqual([{ fieldId: course?.schema.id, status: 'filled' }]);
    expect(input?.value).toBe('Information Systems');
    expect(events).toEqual(['input', 'change', 'focusout']);
  });

  it('still refuses free text where the combobox offers a closed list', async () => {
    render(`
      <div><div>Nível</div><div role="combobox" aria-controls="levels"><input /></div></div>
      <ul role="listbox" id="levels"><li role="option">Básico</li><li role="option">Avançado</li></ul>`);
    const extracted = await extract();
    const fields = new Map(extracted.map((field) => [field.schema.id, field]));
    const [result] = await fillFields(
      fields,
      [{ fieldId: extracted[0]?.schema.id ?? '', action: 'fill', value: 'Fluente', confidence: 1 }],
      { delayMs: 0, combobox: { hasBox: ALWAYS_HAS_BOX, timeoutMs: 20 } },
    );
    expect(result).toMatchObject({ status: 'failed' });
  });
});
