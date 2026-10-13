import type { AnswerEntry } from '../../shared/answers';
import type { Resume } from '../../shared/resume';
import type { ButtonInfo, FieldSchema } from '../../shared/types';

/** Value a "fill" decision carries for an upload field that wants the resume document. */
export const RESUME_FILE_VALUE = 'resume';

export const MAPPER_SYSTEM_PROMPT = `You help a job applicant fill in an application form. The applicant reviews everything before submitting, so your job is to save them typing, not to guess: a wrong value they fail to notice is worse than a field left for them to answer.

The user message is a JSON object with:
- "fields": the form fields currently visible. Each has an "id", a "type", a "label", whether it is "required", its "currentValue", and when relevant the "options" it offers, a "placeholder", the "group" (section) it sits in and an "error" the form showed for the value it currently holds.
- "resume": the applicant's resume in JSON Resume format, with applicant-specific data under "x-extra".
- "answers": answers the applicant gave before to questions the resume does not cover. Each has an "id", the "question" as it was asked then, and the "answer".
- "jobDescription": the job posting, when available.
- "feedback": problems found in your previous answer for this same form, when there were any. Fix them.

Return one decision for every field, in the same order, using its "id" as "fieldId".

Choosing the action:
- "fill" when the resume states the answer or it follows directly from it (for example the country from the phone prefix and address together, or "years of experience" from the work dates), or when one of the "answers" is about the same thing the field asks, even if worded differently or in another language.
- "ask_user" when the form asks for something neither the resume nor the answers contain: salary expectations, notice period, visa sponsorship, how they heard about the job, demographic questions, and so on. Consent and agreement checkboxes are always "ask_user". Never invent personal facts, dates, numbers or credentials.
- "skip" when the field should be left as it is: it already holds the right value, or it is optional and nothing applies.

Choosing the value:
- Fields with "options" (select, radio, combobox): the value must be copied exactly from "options". Pick the option that means the same as the data you have ("Portugal" for country code "PT", "Portuguese Republic" if that is how the form spells it). If no option fits, use "ask_user". Multi-select fields take an array of options.
- Checkboxes take true or false.
- File uploads: use the value "${RESUME_FILE_VALUE}" when the field asks for the resume or CV. Use "skip" for optional uploads of anything else (cover letter, portfolio, certificates) and "ask_user" when such an upload is required.
- Dates: follow the format in "placeholder" when there is one. Fields of type "date" without another hint take YYYY-MM-DD. When the resume has only year and month and the field needs a full date, use the first day of the month.
- A field with an "error" was filled with "currentValue" and the form rejected it. Read the error and return a corrected value: usually a different format (date order, separators, phone prefix, length). If the error means the form wants information you do not have, use "ask_user".
- Phone, postal code and similar fields: follow the placeholder's format when it shows one.
- Fields in a numbered or repeated "group" (several experiences, several degrees) map to resume entries in order: the group with index 0 is the first entry of that resume section, index 1 the second. Use "skip" for a group's fields when the resume has no entry for it. When one repeated section takes entries of more than one kind (courses and certifications in the same list, for example), fill its groups with the entries of the first kind in order, then with those of the next kind, and answer any field that tells the kinds apart ("Is this a certification?") accordingly.
- Resume content goes in exactly as the resume has it. Copy names, titles, descriptions and lists word for word, in the language the resume is written in, whatever language the form is in. Do not translate, reword, summarise, shorten or "improve" them: the applicant chose that wording and expects to find it on the form. The only values you adapt to the form are the ones the form constrains: an option copied from "options", a date or number in the format the field asks for.
- Fields that ask for the content of a resume entry (activities, responsibilities, achievements, description of the role): use that entry's own text. Put its "summary" first when it has one, then its "highlights", one per line, unchanged. Fields that ask for technologies, tools or skills: list the entry's "keywords" (or the matching resume skills) as written, separated by commas. If the field has a length limit you can see and the text does not fit, keep whole items from the start and drop the rest rather than rewriting.
- Open questions the resume has no ready text for (cover letter, "why do you want to work here?"): write a draft in the first person, in the language the resume is written in, grounded only in the resume and the job description, and set "needsReview" to true.
- Everything else is a string.

For every decision:
- "value" is null unless the action is "fill".
- "source" says where a filled value came from: the path of the resume property you used, such as "basics.email", "basics.location.city" or "work[0].position", or "answers.<id>" for one of the answers. Use null when the value combines several properties, is inferred, or is text you wrote.
- "confidence" is between 0 and 1: how sure you are that the value is what the applicant would type. Use lower values when you inferred rather than copied.
- "reason" is one short sentence the applicant will read, saying where the value came from or what you need from them.
- "needsReview" is true for generated text and for anything the applicant should double-check.`;

export const DECISIONS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldId', 'action', 'value', 'source', 'confidence', 'reason', 'needsReview'],
        properties: {
          fieldId: { type: 'string' },
          action: { type: 'string', enum: ['fill', 'skip', 'ask_user'] },
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'boolean' },
              { type: 'array', items: { type: 'string' } },
              { type: 'null' },
            ],
          },
          source: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
          needsReview: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export interface MapperPromptInput {
  fields: readonly FieldSchema[];
  resume: Resume;
  answers?: readonly AnswerEntry[];
  jobDescription?: string;
  feedback?: readonly string[];
}

/** Only what the model needs to decide: no selectors, frame ids or page HTML. */
function describeField(field: FieldSchema) {
  return {
    id: field.id,
    type: field.type,
    label: field.label,
    required: field.required,
    currentValue: field.value,
    ...(field.options ? { options: field.options } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.group ? { group: { label: field.group.label, index: field.group.index } } : {}),
    ...(field.error ? { error: field.error } : {}),
  };
}

export function buildMapperUserMessage(input: MapperPromptInput): string {
  const answers = (input.answers ?? []).map(({ id, question, answer }) => ({
    id,
    question,
    answer,
  }));
  return JSON.stringify({
    fields: input.fields.map(describeField),
    resume: input.resume,
    ...(answers.length > 0 ? { answers } : {}),
    ...(input.jobDescription ? { jobDescription: input.jobDescription } : {}),
    ...(input.feedback?.length ? { feedback: input.feedback } : {}),
  });
}

export const BUTTON_SYSTEM_PROMPT = `A job applicant is filling in a multi-step application form and has finished the current step. The user message is a JSON object with "buttons": the texts of the buttons visible on the page, in order.

Return the index of the button that moves to the next step of the form without submitting the application. Return null when no button clearly does that: for example when the only way forward submits or sends the application, or when the buttons only go back, cancel, save a draft, add items or open help.`;

export const BUTTON_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['index'],
  properties: { index: { anyOf: [{ type: 'integer' }, { type: 'null' }] } },
} as const;

export function buildButtonUserMessage(buttons: readonly ButtonInfo[]): string {
  return JSON.stringify({ buttons: buttons.map((button) => button.text) });
}
