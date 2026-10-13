import { z } from 'zod';
import { en as zodEn, pt as zodPt } from 'zod/locales';
import { createTranslator, type Locale } from './i18n';
import { errorMessage } from './text';

const DATE_FORMAT_ISSUE = '@@date-format';

const text = z.string();
const textList = z.array(text);
const isoDate = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, { error: DATE_FORMAT_ISSUE });

const location = z.looseObject({
  address: text.optional(),
  postalCode: text.optional(),
  city: text.optional(),
  countryCode: text.optional(),
  region: text.optional(),
});

const profile = z.looseObject({
  network: text.optional(),
  username: text.optional(),
  url: text.optional(),
});

const basics = z.looseObject({
  name: text.trim().min(1),
  email: z.email(),
  label: text.optional(),
  image: text.optional(),
  phone: text.optional(),
  url: text.optional(),
  summary: text.optional(),
  location: location.optional(),
  profiles: z.array(profile).optional(),
});

const work = z.looseObject({
  name: text.optional(),
  position: text.optional(),
  location: text.optional(),
  url: text.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  summary: text.optional(),
  highlights: textList.optional(),
});

const education = z.looseObject({
  institution: text.optional(),
  url: text.optional(),
  area: text.optional(),
  studyType: text.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  score: text.optional(),
  courses: textList.optional(),
});

const certificate = z.looseObject({
  name: text.optional(),
  date: isoDate.optional(),
  issuer: text.optional(),
  url: text.optional(),
});

const skill = z.looseObject({
  name: text.optional(),
  level: text.optional(),
  keywords: textList.optional(),
});

const language = z.looseObject({
  language: text.optional(),
  fluency: text.optional(),
});

const project = z.looseObject({
  name: text.optional(),
  description: text.optional(),
  highlights: textList.optional(),
  keywords: textList.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  url: text.optional(),
  roles: textList.optional(),
});

const extra = z.looseObject({
  nationality: textList.optional(),
  dateOfBirth: isoDate.optional(),
  availability: text.optional(),
  noticePeriod: text.optional(),
  workAuthorization: textList.optional(),
  certifications: z
    .array(
      z.looseObject({
        name: text,
        issuer: text.optional(),
        date: isoDate.optional(),
        expires: isoDate.optional(),
        credentialId: text.optional(),
        url: text.optional(),
      }),
    )
    .optional(),
  links: z.array(z.looseObject({ label: text, url: text })).optional(),
});

export const resumeSchema = z.looseObject({
  basics,
  work: z.array(work).optional(),
  education: z.array(education).optional(),
  certificates: z.array(certificate).optional(),
  skills: z.array(skill).optional(),
  languages: z.array(language).optional(),
  projects: z.array(project).optional(),
  'x-extra': extra.optional(),
});

export type Resume = z.infer<typeof resumeSchema>;

export interface ResumeIssue {
  path: string;
  message: string;
}

export type ResumeParseResult = { ok: true; resume: Resume } | { ok: false; issues: ResumeIssue[] };

const ZOD_ERROR_MAPS = { en: zodEn().localeError, pt: zodPt().localeError };

function formatPath(path: readonly PropertyKey[], rootLabel: string): string {
  if (path.length === 0) return rootLabel;
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join('');
}

export function validateResume(data: unknown, locale: Locale): ResumeParseResult {
  const t = createTranslator(locale);
  const result = resumeSchema.safeParse(data, { error: ZOD_ERROR_MAPS[locale] });
  if (result.success) return { ok: true, resume: result.data };
  const issues = result.error.issues.map((issue) => ({
    path: formatPath(issue.path, t('validation.root')),
    message: issue.message === DATE_FORMAT_ISSUE ? t('validation.dateFormat') : issue.message,
  }));
  return { ok: false, issues };
}

export function parseResumeJson(json: string, locale: Locale): ResumeParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    const t = createTranslator(locale);
    const detail = errorMessage(error);
    return {
      ok: false,
      issues: [{ path: 'JSON', message: t('validation.invalidJson', { detail }) }],
    };
  }
  return validateResume(data, locale);
}
