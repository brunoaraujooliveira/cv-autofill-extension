import { describe, expect, it, vi } from 'vitest';
import { queryAllDeep, waitForQuiet } from '../../../src/content/dom';
import { attachFile } from '../../../src/content/filler/file';
import { fillFields } from '../../../src/content/filler';
import {
  buttonText,
  classifyButtonText,
  findButtons,
} from '../../../src/content/navigator/buttons';
import { findStepTitle, looksLikeFinalStep } from '../../../src/content/navigator/step-id';
import { waitForStepChange } from '../../../src/content/navigator/wait';
import { addBlock, findRepeatables } from '../../../src/content/repeater';
import { capturePage } from '../../../src/content/snapshot';
import { findFieldError } from '../../../src/content/validation';
import { ALWAYS_HAS_BOX, extract, render } from './helpers';

const OPTIONS = { hasBox: ALWAYS_HAS_BOX };
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;

describe('classifyButtonText', () => {
  it.each([
    'Next',
    'Continue',
    'Save and continue',
    'Next: Review',
    'Seguinte',
    'Continuar',
    'Próximo',
    'Avançar',
    'Weiter',
    'Suivant',
    'Avanti',
    'Siguiente',
  ])('treats "%s" as a way to the next step', (text) => {
    expect(classifyButtonText(text)).toBe('advance');
  });

  it.each([
    'Submit',
    'Submit application',
    'Apply',
    'Apply now',
    'Send',
    'Enviar candidatura',
    'Candidatar-me',
    'Finalizar',
    'Absenden',
    'Jetzt bewerben',
    'Envoyer',
    'Postuler',
    'Invia',
  ])('treats "%s" as submitting', (text) => {
    expect(classifyButtonText(text)).toBe('submit');
  });

  it.each([
    'Confirm',
    'Confirm and continue',
    'Complete application',
    'Done',
    'Register',
    'Sign up',
    'Aplicar',
    'Candidate-se',
    'Confirmar candidatura',
    'Bewerbung senden',
    'Valider',
    'Terminer',
    'Conferma',
  ])('also treats "%s" as submitting', (text) => {
    expect(classifyButtonText(text)).toBe('submit');
  });

  it.each([
    'Continue with Google',
    'Continuar com LinkedIn',
    'Sign in to continue',
    'Weiter mit Xing',
  ])('does not take "%s" for the next step of the form', (text) => {
    expect(classifyButtonText(text)).toBe('other');
  });

  it.each(['Continue and submit', 'Next: send application', 'Finish and continue'])(
    'treats "%s" as submitting even though it also reads like continuing',
    (text) => {
      expect(classifyButtonText(text)).toBe('submit');
    },
  );

  it.each(['Back', 'Cancel', 'Save draft', 'Add experience', 'Help', 'Nextdoor', ''])(
    'treats "%s" as neither',
    (text) => {
      expect(classifyButtonText(text)).toBe('other');
    },
  );
});

describe('findButtons', () => {
  it('lists visible buttons of every kind with their state', () => {
    render(`
      <button id="back">Back</button>
      <button id="next" disabled>Next</button>
      <input id="send" type="submit" value="Submit application" />
      <div id="custom" role="button" aria-disabled="true" aria-label="Continue"></div>
      <button hidden>Skip</button>
      <button></button>
      <ul role="listbox"><li><button>Portugal</button></li></ul>`);

    expect(findButtons(document, { ...OPTIONS, frameId: 2 }).map(({ info }) => info)).toEqual([
      { frameId: 2, selector: '#back', text: 'Back', kind: 'other', disabled: false },
      { frameId: 2, selector: '#next', text: 'Next', kind: 'advance', disabled: true },
      {
        frameId: 2,
        selector: '#send',
        text: 'Submit application',
        kind: 'submit',
        disabled: false,
      },
      { frameId: 2, selector: '#custom', text: 'Continue', kind: 'advance', disabled: true },
    ]);
  });

  it('finds elements styled as buttons that are not buttons', () => {
    render(`
      <div id="add" class="app-button btn-prime">Adicionar experiência profissional</div>
      <a id="link-button">Continuar</a>
      <div id="off" class="btn disabled">Seguinte</div>
      <div class="btn-group"><button id="real"><span class="btn-label">Voltar</span></button></div>
      <div class="button-bar"><input aria-label="Search" /></div>
      <a href="/jobs/next">Next job</a>
      <p class="btn">${'Long text is prose, not a button. '.repeat(3)}</p>`);

    expect(
      findButtons(document, OPTIONS).map(({ info }) => [info.selector, info.kind, info.disabled]),
    ).toEqual([
      ['#add', 'other', false],
      ['#link-button', 'advance', false],
      ['#off', 'advance', true],
      ['#real', 'other', false],
    ]);
  });

  it('finds plain elements the page made clickable, once each', () => {
    render(`
      <div id="cta" style="cursor: pointer"><span>Seguinte</span></div>
      <div id="card" style="cursor: pointer"><input aria-label="Name" /><span>Open</span></div>
      <label style="cursor: pointer">Remember me</label>
      <a href="/next" style="cursor: pointer">Next job</a>
      <p id="prose" style="cursor: pointer">${'Clickable paragraph of prose. '.repeat(4)}</p>
      <span id="plain">Just text</span>`);

    expect(findButtons(document, OPTIONS).map(({ info }) => [info.selector, info.kind])).toEqual([
      ['#cta', 'advance'],
    ]);
  });

  it('never takes a link with a real destination for a button, however it is styled', () => {
    render(`
      <a id="oauth" class="btn btn-primary" href="https://accounts.example.com/login">Continue</a>
      <a class="btn" href="/jobs"><span class="btn-label">Next</span></a>
      <a id="hash" class="btn" href="#">Next</a>`);
    expect(findButtons(document, OPTIONS).map(({ info }) => info.selector)).toEqual(['#hash']);
  });

  it('leaves out buttons that another browser extension injected into the page', () => {
    render('<button id="next">Next</button><grammarly-extension id="g"></grammarly-extension>');
    $('#g').attachShadow({ mode: 'open' }).innerHTML = '<button>Rewrite with Grammarly</button>';
    expect(findButtons(document, OPTIONS).map(({ info }) => info.text)).toEqual(['Next']);
  });

  it('reads the text from the content, the value, aria-label or title', () => {
    render('<button id="a"> Save  and\n continue </button><button id="b" title="Next"></button>');
    expect(buttonText($('#a'))).toBe('Save and continue');
    expect(buttonText($('#b'))).toBe('Next');
  });
});

describe('findStepTitle', () => {
  it('prefers the active item of a stepper or tab list over headings', () => {
    render(`
      <h1>Apply: Senior Engineer</h1>
      <ol><li role="tab" aria-selected="false">Personal</li><li role="tab" aria-selected="true">Contact</li></ol>`);
    expect(findStepTitle(document, ALWAYS_HAS_BOX)).toBe('Contact');

    render('<nav><span aria-current="step">Step 2 of 4</span></nav><h1>Apply</h1>');
    expect(findStepTitle(document, ALWAYS_HAS_BOX)).toBe('Step 2 of 4');
  });

  it('falls back to the first visible heading, then to nothing', () => {
    render('<h1 hidden>Hidden</h1><h2>Your experience</h2>');
    expect(findStepTitle(document, ALWAYS_HAS_BOX)).toBe('Your experience');
    render('<p>No headings here</p>');
    expect(findStepTitle(document, ALWAYS_HAS_BOX)).toBeUndefined();
  });
});

describe('looksLikeFinalStep', () => {
  const stepper = (current: number) =>
    `<ol>${['Personal', 'Contact', 'Review']
      .map((name, index) => `<li role="tab" aria-selected="${index === current}">${name}</li>`)
      .join('')}</ol>`;

  it('recognises the last item of a stepper', () => {
    render(stepper(2).replace('Review', 'Extras'));
    expect(looksLikeFinalStep(document, ALWAYS_HAS_BOX)).toBe(true);
    render(stepper(1));
    expect(looksLikeFinalStep(document, ALWAYS_HAS_BOX)).toBe(false);
  });

  it.each(['Review your application', 'Revisão', 'Confirmação dos dados', 'Récapitulatif'])(
    'recognises a step titled "%s"',
    (title) => {
      render(`<h1>${title}</h1>`);
      expect(looksLikeFinalStep(document, ALWAYS_HAS_BOX)).toBe(true);
    },
  );

  it.each(['Work experience', 'Professional summary', 'Preview of benefits'])(
    'does not take "%s" for the final review',
    (title) => {
      render(`<h1>${title}</h1><ol><li aria-current="step">Only step</li></ol>`);
      expect(looksLikeFinalStep(document, ALWAYS_HAS_BOX)).toBe(false);
    },
  );
});

describe('findFieldError', () => {
  const errorOf = (selector: string) => findFieldError([$(selector)], ALWAYS_HAS_BOX);

  it('reads aria-errormessage and the description of an invalid field', () => {
    render(`
      <input id="a" aria-invalid="true" aria-errormessage="a-error" /><p id="a-error">Required format: +351…</p>
      <input id="b" aria-invalid="true" aria-describedby="b-help" /><p id="b-help">Too short</p>`);
    expect(errorOf('#a')).toBe('Required format: +351…');
    expect(errorOf('#b')).toBe('Too short');
  });

  it('does not take a plain description of a valid field for an error', () => {
    render('<input id="a" aria-describedby="help" /><p id="help">As in your passport</p>');
    expect(errorOf('#a')).toBeUndefined();
  });

  it('takes a description that looks like an error even without aria-invalid', () => {
    render(
      '<input id="a" aria-describedby="err" /><p id="err" class="field-error">Invalid date</p>',
    );
    expect(errorOf('#a')).toBe('Invalid date');
  });

  it('finds an error element next to the field, but not one that belongs to a neighbour', () => {
    render(`
      <div class="row"><input id="a" /><span class="invalid-feedback">Not a valid code</span></div>
      <div class="row"><input id="b" /></div>
      <div class="pair"><input id="c" /><input id="d" /><span class="error">Which one?</span></div>`);
    expect(errorOf('#a')).toBe('Not a valid code');
    expect(errorOf('#b')).toBeUndefined();
    expect(errorOf('#c')).toBeUndefined();
  });

  it('ignores hidden, empty and essay-length error elements', () => {
    render(`
      <div><input id="a" /><span class="error" hidden>Old message</span></div>
      <div><input id="b" /><span class="error">  </span></div>
      <div><input id="c" /><div role="alert">${'x'.repeat(300)}</div></div>`);
    expect([errorOf('#a'), errorOf('#b'), errorOf('#c')]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('checks every radio of a group and the group wrapper', () => {
    render(`
      <fieldset><label><input type="radio" name="r" id="r1" /> Yes</label>
        <label><input type="radio" name="r" id="r2" /> No</label>
        <p role="alert">Choose one</p></fieldset>`);
    expect(findFieldError([$('#r1'), $('#r2')], ALWAYS_HAS_BOX)).toBe('Choose one');
  });

  it('uses the browser message for a rejected value, not for a field left empty', () => {
    render('<div><input id="email" type="email" required /></div>');
    const input = $('#email') as HTMLInputElement;
    const validity = (state: Partial<ValidityState>, message: string) => {
      Object.defineProperty(input, 'validity', {
        configurable: true,
        value: { valid: false, ...state },
      });
      Object.defineProperty(input, 'validationMessage', { configurable: true, value: message });
    };

    validity({ valueMissing: true }, 'Please fill out this field.');
    expect(errorOf('#email')).toBeUndefined();
    validity({ typeMismatch: true }, 'Please include an @ in the address.');
    expect(errorOf('#email')).toBe('Please include an @ in the address.');
  });
});

describe('repeatable sections', () => {
  const repeatables = () => findRepeatables(findButtons(document, OPTIONS), ALWAYS_HAS_BOX);

  it('finds "Add" buttons, the resume section they repeat and the blocks already there', () => {
    render(`
      <section><h2>Work experience</h2>
        <fieldset><legend>Experience 1</legend><input aria-label="Company" /><input aria-label="Title" /></fieldset>
        <fieldset><legend>Experience 2</legend><input aria-label="Company" /><input aria-label="Title" /></fieldset>
        <button id="add-work" type="button">Add another</button></section>
      <section><h2>Formação académica</h2><button id="add-edu" type="button">+ Adicionar</button></section>
      <button id="add-lang" type="button">Add language</button>
      <button id="remove" type="button">Remove experience</button>
      <button id="add-file" type="button">Add attachment</button>`);

    expect(repeatables()).toEqual([
      {
        frameId: 0,
        selector: '#add-work',
        text: 'Add another',
        kinds: ['work'],
        existingBlocks: 2,
      },
      {
        frameId: 0,
        selector: '#add-edu',
        text: '+ Adicionar',
        kinds: ['education'],
        existingBlocks: 0,
      },
      {
        frameId: 0,
        selector: '#add-lang',
        text: 'Add language',
        kinds: ['languages'],
        existingBlocks: 0,
      },
    ]);
  });

  it('recognizes a section that mixes two kinds of entries', () => {
    render(`
      <section><h3>Cursos e certificações</h3>
        <label>Curso <input /></label><label>Instituição <input /></label>
        <button id="add" type="button">Adicionar outro curso e instituição</button></section>`);
    expect(repeatables()).toEqual([
      {
        frameId: 0,
        selector: '#add',
        text: 'Adicionar outro curso e instituição',
        kinds: ['education', 'certificates'],
        existingBlocks: 1,
      },
    ]);
  });

  it('ignores disabled "Add" buttons', () => {
    render('<section><h2>Education</h2><button disabled>Add education</button></section>');
    expect(repeatables()).toEqual([]);
  });

  it('clicks and waits for the new block to show up', async () => {
    render('<div id="blocks"></div><button id="add">Add experience</button>');
    $('#add').addEventListener('click', () => {
      setTimeout(() => {
        $('#blocks').insertAdjacentHTML('beforeend', '<input aria-label="Company" />');
      }, 5);
    });
    expect(await addBlock($('#add'), OPTIONS)).toBe(true);
    expect(document.querySelectorAll('#blocks input')).toHaveLength(1);
  });

  it('reports when clicking adds nothing', async () => {
    render('<button id="add">Add experience</button>');
    expect(await addBlock($('#add'), { ...OPTIONS, timeoutMs: 20 })).toBe(false);
  });
});

describe('waitForStepChange', () => {
  const marker = (signature: string, url = 'https://jobs.example.com/apply') => ({
    url,
    signature,
  });
  const quick = { timeoutMs: 300, settleMs: 5 };

  it('resolves true once the fields on screen change', async () => {
    render('<div id="step"></div>');
    let current = marker('one');
    const changed = waitForStepChange(marker('one'), () => Promise.resolve(current), quick);
    current = marker('two');
    $('#step').textContent = 'Step 2';
    expect(await changed).toBe(true);
  });

  it('resolves true when only the address changes', async () => {
    const read = () => Promise.resolve(marker('one', 'https://jobs.example.com/apply/step-2'));
    expect(await waitForStepChange(marker('one'), read, quick)).toBe(true);
  });

  it('resolves false at the safety timeout when nothing changes', async () => {
    const read = vi.fn(() => Promise.resolve(marker('one')));
    expect(await waitForStepChange(marker('one'), read, { timeoutMs: 40, settleMs: 5 })).toBe(
      false,
    );
    expect(read).toHaveBeenCalled();
  });
});

describe('capturePage', () => {
  it('describes the frame: fields, buttons, title, repeatables and embedded frames', async () => {
    render(`
      <h1>Contact</h1>
      <label for="email">Email</label><input id="email" type="email" />
      <section><h2>Languages</h2><button id="add">Add language</button></section>
      <button id="next">Next</button>
      <iframe src="https://forms.example/embed"></iframe>
      <iframe src="https://forms.example/other"></iframe>
      <iframe src="/same-origin.html"></iframe>
      <iframe src="about:blank"></iframe>
      <iframe src="https://hidden.example/x" hidden></iframe>`);
    const capture = await capturePage(document, { ...OPTIONS, frameId: 4 });

    expect(capture.snapshot).toMatchObject({
      origin: location.origin,
      url: location.href,
      title: 'Contact',
      fields: [{ label: 'Email', frameId: 4 }],
      buttons: [{ text: 'Add language' }, { text: 'Next', kind: 'advance', frameId: 4 }],
      repeatables: [{ kinds: ['languages'], selector: '#add' }],
      iframeOrigins: ['https://forms.example'],
    });
    expect(capture.buttons.get('#next')).toBe($('#next'));
    expect([...capture.fields.values()][0]?.elements).toEqual([$('#email')]);
  });
});

describe('queryAllDeep and waitForQuiet', () => {
  it('returns matches in document order across shadow roots', () => {
    render('<input id="a" /><div id="host"></div><input id="c" />');
    $('#host').attachShadow({ mode: 'open' }).innerHTML = '<input id="b" />';
    expect(queryAllDeep(document, 'input').map((input) => input.id)).toEqual(['a', 'b', 'c']);
  });

  it('waits for the page to stop changing, up to a limit', async () => {
    render('<p id="live"></p>');
    let ticks = 0;
    const timer = setInterval(() => {
      $('#live').textContent = String((ticks += 1));
    }, 5);
    await waitForQuiet({ quietMs: 30, timeoutMs: 80 });
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);

    const before = ticks;
    await waitForQuiet({ quietMs: 10, timeoutMs: 500 });
    expect(ticks).toBe(before);
  });
});

describe('file uploads', () => {
  const PDF = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };

  it('attaches the file and fires the events a page listens for', () => {
    render('<input id="cv" type="file" />');
    const input = $('#cv') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    attachFile(input, PDF);

    expect(input.files?.[0]).toMatchObject({
      name: 'resume.pdf',
      type: 'application/pdf',
      size: 13,
    });
    expect(events).toEqual(['input', 'change']);
  });

  it('fills an upload field when a file is available, and asks the user otherwise', async () => {
    render('<label for="cv">Resume</label><input id="cv" type="file" />');
    const extracted = await extract();
    const fields = new Map(extracted.map((field) => [field.schema.id, field]));
    const decision = {
      fieldId: extracted[0]?.schema.id ?? '',
      action: 'fill' as const,
      value: 'resume',
      confidence: 1,
    };

    expect(await fillFields(fields, [decision], { delayMs: 0, file: PDF })).toEqual([
      { fieldId: decision.fieldId, status: 'filled' },
    ]);
    expect((await fillFields(fields, [decision], { delayMs: 0 }))[0]?.status).toBe(
      'pending_manual',
    );
  });
});
