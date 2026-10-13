import { z } from 'zod';
import type { Resume } from '../../shared/resume';
import { findOptionIndex } from '../../shared/text';
import type { AnswerEntry } from '../../shared/answers';
import type { ButtonInfo, FieldDecision, FieldSchema } from '../../shared/types';
import { LlmError, type LlmClient } from './client';
import {
  buildButtonUserMessage,
  buildMapperUserMessage,
  BUTTON_JSON_SCHEMA,
  BUTTON_SYSTEM_PROMPT,
  DECISIONS_JSON_SCHEMA,
  MAPPER_SYSTEM_PROMPT,
  RESUME_FILE_VALUE,
} from './prompts';

export interface MapRequest {
  fields: readonly FieldSchema[];
  resume: Resume;
  answers?: readonly AnswerEntry[];
  jobDescription?: string;
}

export interface LlmCredentials {
  apiKey: string;
  model: string;
}

const wireDecisionSchema = z.object({
  fieldId: z.string(),
  action: z.enum(['fill', 'skip', 'ask_user']),
  value: z.union([z.string(), z.boolean(), z.array(z.string()), z.null()]).optional(),
  source: z.string().nullable().optional(),
  confidence: z.number(),
  reason: z.string().optional(),
  needsReview: z.boolean().optional(),
});

const wireResponseSchema = z.object({ decisions: z.array(wireDecisionSchema) });

const buttonChoiceSchema = z.object({ index: z.number().int().nullable() });

type WireDecision = z.infer<typeof wireDecisionSchema>;
type FillValue = NonNullable<FieldDecision['value']>;

interface Interpretation {
  decisions: FieldDecision[];
  /** What was wrong with the answer, phrased so the model can fix it on a retry. */
  problems: string[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function askUser(fieldId: string, reason: string): FieldDecision {
  return { fieldId, action: 'ask_user', confidence: 0, reason };
}

function matchOptions(field: FieldSchema, value: string | string[]): FillValue | Error {
  const options = field.options ?? [];
  const canonical: string[] = [];
  for (const wanted of Array.isArray(value) ? value : [value]) {
    const option = options[findOptionIndex(options, wanted)];
    if (option === undefined) return new Error(`"${wanted}" is not one of the options`);
    canonical.push(option);
  }
  return Array.isArray(value) ? canonical : (canonical[0] ?? new Error('the value is empty'));
}

/** Checks a "fill" value against what the field can take, returning the value to use or why not. */
function validateValue(field: FieldSchema, value: WireDecision['value']): FillValue | Error {
  if (value === null || value === undefined) return new Error('action is "fill" but value is null');
  if (field.type === 'checkbox') {
    return typeof value === 'boolean' ? value : new Error('checkboxes take true or false');
  }
  if (typeof value === 'boolean') return new Error('only checkboxes take true or false');
  if (field.type === 'file') {
    return value === RESUME_FILE_VALUE
      ? value
      : new Error(`upload fields only take "${RESUME_FILE_VALUE}"`);
  }
  if (field.options?.length) return matchOptions(field, value);
  if (Array.isArray(value)) return new Error('this field takes a single text value');
  return value.trim() === '' ? new Error('the value is empty') : value;
}

function toDecision(field: FieldSchema, wire: WireDecision): FieldDecision | Error {
  const base = {
    fieldId: field.id,
    action: wire.action,
    confidence: clamp01(wire.confidence),
    origin: 'llm' as const,
    ...(wire.reason ? { reason: wire.reason } : {}),
  };
  if (wire.action !== 'fill') return base;

  const value = validateValue(field, wire.value);
  if (value instanceof Error) return value;
  const needsReview = (wire.needsReview ?? false) || field.type === 'textarea';
  return {
    ...base,
    value,
    ...(wire.source ? { source: wire.source } : {}),
    ...(needsReview ? { needsReview } : {}),
  };
}

function interpret(raw: unknown, fields: readonly FieldSchema[]): Interpretation | null {
  const parsed = wireResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  const wireById = new Map(parsed.data.decisions.map((decision) => [decision.fieldId, decision]));
  const problems: string[] = [];
  const decisions = fields.map((field) => {
    const wire = wireById.get(field.id);
    if (!wire) {
      problems.push(`Field ${field.id} ("${field.label}"): no decision was returned`);
      return askUser(field.id, 'No answer was produced for this field.');
    }
    const decision = toDecision(field, wire);
    if (decision instanceof Error) {
      problems.push(`Field ${field.id} ("${field.label}"): ${decision.message}`);
      return askUser(field.id, `The suggested value was not usable (${decision.message}).`);
    }
    return decision;
  });
  return { decisions, problems };
}

/** Turns a form step into validated decisions, never letting through a value the field cannot take. */
export class Mapper {
  constructor(private readonly client: LlmClient) {}

  async map(request: MapRequest, credentials: LlmCredentials): Promise<FieldDecision[]> {
    const first = await this.ask(request, credentials);
    if (first?.problems.length === 0) return first.decisions;

    const feedback = first?.problems ?? ['The answer did not follow the required JSON format.'];
    const second = await this.ask(request, credentials, feedback);
    if (second) return second.decisions;
    if (first) return first.decisions;
    throw new LlmError('invalid_response', 'The answer did not follow the required format');
  }

  /**
   * Picks the button that moves to the next step when the texts alone did not settle it.
   * Returns null when the model sees no safe choice.
   */
  async chooseAdvanceButton(
    buttons: readonly ButtonInfo[],
    credentials: LlmCredentials,
  ): Promise<ButtonInfo | null> {
    const raw = await this.client.completeJson({
      ...credentials,
      system: BUTTON_SYSTEM_PROMPT,
      user: buildButtonUserMessage(buttons),
      schema: BUTTON_JSON_SCHEMA,
    });
    const parsed = buttonChoiceSchema.safeParse(raw);
    return parsed.success && parsed.data.index !== null
      ? (buttons[parsed.data.index] ?? null)
      : null;
  }

  private async ask(
    request: MapRequest,
    credentials: LlmCredentials,
    feedback?: readonly string[],
  ): Promise<Interpretation | null> {
    const raw = await this.client.completeJson({
      ...credentials,
      system: MAPPER_SYSTEM_PROMPT,
      user: buildMapperUserMessage({ ...request, ...(feedback ? { feedback } : {}) }),
      schema: DECISIONS_JSON_SCHEMA,
    });
    return interpret(raw, request.fields);
  }
}
