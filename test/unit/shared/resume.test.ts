import { describe, expect, it } from 'vitest';
import exampleResume from '../../../examples/resume.example.json';
import { parseResumeJson, validateResume } from '../../../src/shared/resume';

const minimal = { basics: { name: 'Ana', email: 'ana@example.com' } };

describe('validateResume', () => {
  it('accepts the bundled example', () => {
    expect(validateResume(exampleResume, 'en')).toMatchObject({ ok: true });
  });

  it('accepts a resume with only name and email', () => {
    expect(validateResume(minimal, 'en')).toEqual({ ok: true, resume: minimal });
  });

  it('keeps properties the schema does not know about', () => {
    const resume = { ...minimal, awards: [{ title: 'Best talk' }], 'x-extra': { pronouns: 'she' } };
    expect(validateResume(resume, 'en')).toEqual({ ok: true, resume });
  });

  it('reports a missing email with its path', () => {
    const result = validateResume({ basics: { name: 'Ana' } }, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.path)).toEqual(['basics.email']);
  });

  it('reports nested array positions and explains the date format', () => {
    const result = validateResume({ ...minimal, work: [{}, { startDate: '03/2021' }] }, 'en');
    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'work[1].startDate', message: 'Use YYYY, YYYY-MM or YYYY-MM-DD' }],
    });
  });

  it.each(['2021', '2021-03', '2021-03-31'])('accepts the date %s', (startDate) => {
    expect(validateResume({ ...minimal, work: [{ startDate }] }, 'en').ok).toBe(true);
  });

  it.each(['21', '2021-13', '2021-02-32', '2021/03'])('rejects the date %s', (startDate) => {
    expect(validateResume({ ...minimal, work: [{ startDate }] }, 'en').ok).toBe(false);
  });

  it('labels the root when the document is not an object', () => {
    const result = validateResume([], 'pt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('(raiz)');
  });

  it('localizes messages', () => {
    const data = { basics: { name: 'Ana', email: 'not-an-email' } };
    const english = validateResume(data, 'en');
    const portuguese = validateResume(data, 'pt');
    if (english.ok || portuguese.ok) throw new Error('expected both to fail');
    expect(english.issues[0]?.message).not.toBe(portuguese.issues[0]?.message);
  });
});

describe('parseResumeJson', () => {
  it('parses valid JSON text', () => {
    expect(parseResumeJson(JSON.stringify(minimal), 'en')).toEqual({ ok: true, resume: minimal });
  });

  it('reports malformed JSON as a single readable issue', () => {
    const result = parseResumeJson('{ "basics": ', 'pt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toMatch(/^JSON inválido: /);
    }
  });
});
