/**
 * Deterministic stand-in for the model: decides from the field label with a fixed rule table,
 * reading the answers from the resume it receives so the tests prove the resume reaches it.
 */

interface MockField {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
  group?: { label: string; index: number };
  error?: string;
}

interface MockResume {
  basics: {
    name: string;
    email: string;
    phone?: string;
    location?: { city?: string; countryCode?: string; postalCode?: string };
    profiles?: { network?: string; url?: string }[];
  };
  work?: { name?: string; position?: string; endDate?: string }[];
  education?: { institution?: string }[];
  'x-extra'?: {
    availability?: string;
    noticePeriod?: string;
    dateOfBirth?: string;
    workAuthorization?: string[];
  };
}

export interface MockPayload {
  fields?: MockField[];
  resume?: MockResume;
  answers?: { id: string; question: string; answer: string | string[] }[];
  buttons?: string[];
}

interface MockDecision {
  fieldId: string;
  action: 'fill' | 'skip' | 'ask_user';
  value: string | boolean | string[] | null;
  source: string | null;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

type Answer = [value: string | boolean | undefined, source: string | null];
type Rule = [RegExp, (resume: MockResume, field: MockField) => Answer];

const COUNTRY_NAMES: Record<string, string> = { PT: 'Portugal', BR: 'Brazil', ES: 'Spain' };
const GENERATED_TEXT = /why do you want|about you/i;

/** The form asked for day/month/year after rejecting the ISO date. */
function birthDate(resume: MockResume, field: MockField): Answer {
  const iso = resume['x-extra']?.dateOfBirth;
  const wantsDayFirst = /DD\/MM\/YYYY/.test(field.error ?? '');
  return [wantsDayFirst ? iso?.split('-').reverse().join('/') : iso, 'x-extra.dateOfBirth'];
}

const indexOf = (field: MockField) => field.group?.index ?? 0;

const RULES: Rule[] = [
  [/first name/i, (resume) => [resume.basics.name.split(' ')[0], 'basics.name']],
  [/last name/i, (resume) => [resume.basics.name.split(' ').slice(1).join(' '), 'basics.name']],
  [/e-?mail/i, (resume) => [resume.basics.email, 'basics.email']],
  [/phone/i, (resume) => [resume.basics.phone, 'basics.phone']],
  [
    /linkedin/i,
    (resume) => [
      resume.basics.profiles?.find((p) => p.network === 'LinkedIn')?.url,
      'basics.profiles',
    ],
  ],
  [
    /country/i,
    (resume) => [
      COUNTRY_NAMES[resume.basics.location?.countryCode ?? ''],
      'basics.location.countryCode',
    ],
  ],
  [/city/i, (resume) => [resume.basics.location?.city, 'basics.location.city']],
  [/postal code/i, (resume) => [resume.basics.location?.postalCode, 'basics.location.postalCode']],
  [/date of birth/i, birthDate],
  [
    /start date/i,
    (resume) => [
      /\d{4}-\d{2}-\d{2}/.exec(resume['x-extra']?.availability ?? '')?.[0],
      'x-extra.availability',
    ],
  ],
  [
    /authorized to work in the eu/i,
    (resume) => [
      resume['x-extra']?.workAuthorization?.includes('European Union') ? 'Yes' : 'No',
      'x-extra.workAuthorization',
    ],
  ],
  [/currently employed/i, (resume) => [resume.work?.[0]?.endDate ? 'No' : 'Yes', null]],
  [/notice period/i, (resume) => [resume['x-extra']?.noticePeriod, 'x-extra.noticePeriod']],
  [
    /company/i,
    (resume, field) => [resume.work?.[indexOf(field)]?.name, `work[${indexOf(field)}].name`],
  ],
  [
    /job title/i,
    (resume, field) => [
      resume.work?.[indexOf(field)]?.position,
      `work[${indexOf(field)}].position`,
    ],
  ],
  [
    /school/i,
    (resume, field) => [
      resume.education?.[indexOf(field)]?.institution,
      `education[${indexOf(field)}].institution`,
    ],
  ],
  [/resume|cv/i, (_, field) => [field.type === 'file' ? 'resume' : undefined, null]],
  [/remote/i, () => [true, null]],
  [GENERATED_TEXT, (resume) => [`Draft written for ${resume.basics.name}.`, null]],
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function fromAnswers(field: MockField, payload: MockPayload): Answer | null {
  const match = payload.answers?.find(
    (answer) => normalize(answer.question) === normalize(field.label),
  );
  return match ? [String(match.answer), `answers.${match.id}`] : null;
}

function decide(field: MockField, payload: MockPayload): MockDecision {
  const base = { fieldId: field.id, needsReview: false, source: null };
  const resume = payload.resume ?? { basics: { name: '', email: '' } };
  const [answer, source] = fromAnswers(field, payload) ??
    RULES.find(([pattern]) => pattern.test(field.label))?.[1](resume, field) ?? [undefined, null];

  if (answer === undefined || answer === '') {
    return field.required
      ? { ...base, action: 'ask_user', value: null, confidence: 0, reason: 'Not in the resume.' }
      : { ...base, action: 'skip', value: null, confidence: 1, reason: 'Nothing applies.' };
  }
  if (field.options && typeof answer === 'string' && !field.options.includes(answer)) {
    return { ...base, action: 'ask_user', value: null, confidence: 0, reason: 'No option fits.' };
  }
  return {
    ...base,
    action: 'fill',
    value: answer,
    source,
    confidence: 0.95,
    reason: 'From the resume.',
    needsReview: GENERATED_TEXT.test(field.label),
  };
}

/** Answers either kind of request the extension makes: field decisions or a button choice. */
export function mockAnswer(payload: MockPayload): unknown {
  if (payload.buttons) {
    const index = payload.buttons.findIndex((text) => /onward/i.test(text));
    return { index: index === -1 ? null : index };
  }
  return { decisions: (payload.fields ?? []).map((field) => decide(field, payload)) };
}
