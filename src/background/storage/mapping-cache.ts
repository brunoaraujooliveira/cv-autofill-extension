import { z } from 'zod';
import type { AnswerEntry, CacheSummary } from '../../shared/answers';
import type { Resume } from '../../shared/resume';
import { fieldKey } from '../../shared/step';
import { findOptionIndex, hashText, isFormatHint } from '../../shared/text';
import type { FieldDecision, FieldSchema } from '../../shared/types';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'mappingCache';
const ANSWER_PREFIX = 'answers.';

const entrySchema = z.object({
  fieldKey: z.string(),
  action: z.enum(['fill', 'skip']),
  value: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
  source: z.string().optional(),
  /** Hash of the data the value was derived from; the entry is stale once that data changes. */
  sourceHash: z.string(),
});

const cacheSchema = z.record(z.string(), z.record(z.string(), z.array(entrySchema)));

type CacheEntry = z.infer<typeof entrySchema>;
type CacheData = z.infer<typeof cacheSchema>;

/** The applicant data a cached value can be traced back to. */
export interface SourceData {
  resume: Resume;
  answers: readonly AnswerEntry[];
}

/** Follows a path such as "work[0].position" through the resume. */
function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(/[.[\]]+/).filter(Boolean)) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Hash of what a source points at. A value without a source depends on the whole resume. */
function hashSource(source: string | undefined, data: SourceData): string | null {
  const value = source?.startsWith(ANSWER_PREFIX)
    ? data.answers.find((answer) => answer.id === source.slice(ANSWER_PREFIX.length))?.answer
    : readPath(data.resume, source ?? '');
  return value === undefined ? null : hashText(JSON.stringify(value));
}

function isCacheable(decision: FieldDecision): boolean {
  if (decision.action === 'skip') return true;
  if (decision.action !== 'fill' || decision.needsReview) return false;
  // Answers typed for one form (consent boxes above all) are only reused through the answer bank.
  return decision.origin !== 'user' || decision.source !== undefined;
}

/** Fields are remembered by label; one that only shows a format would match unrelated fields. */
function hasUsableLabel(field: FieldSchema): boolean {
  return field.label.trim() !== '' && !isFormatHint(field.label);
}

function stillFits(field: FieldSchema, entry: CacheEntry): boolean {
  if (entry.action === 'skip' || !field.options?.length) return true;
  const values = Array.isArray(entry.value) ? entry.value : [String(entry.value)];
  return values.every((value) => findOptionIndex(field.options ?? [], value) !== -1);
}

/**
 * Remembers, per portal and step, which value went into each field and where it came from,
 * so the next application on the same portal is filled without asking the model again.
 */
export class MappingCache {
  constructor(private readonly store: KeyValueStore) {}

  async save(
    domain: string,
    signature: string,
    fields: readonly FieldSchema[],
    decisions: readonly FieldDecision[],
    data: SourceData,
  ): Promise<void> {
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    const entries: CacheEntry[] = [];
    for (const decision of decisions) {
      const field = fieldsById.get(decision.fieldId);
      const sourceHash = hashSource(decision.source, data);
      if (!field || field.error || !isCacheable(decision) || sourceHash === null) continue;
      if (!hasUsableLabel(field)) continue;
      entries.push({
        fieldKey: fieldKey(field),
        action: decision.action === 'skip' ? 'skip' : 'fill',
        ...(decision.value !== undefined ? { value: decision.value } : {}),
        ...(decision.source ? { source: decision.source } : {}),
        sourceHash,
      });
    }
    if (entries.length === 0) return;
    const cache = await this.read();
    cache[domain] = { ...cache[domain], [signature]: entries };
    await this.store.set(STORAGE_KEY, cache);
  }

  /** Decisions for the fields this portal and step were already seen with, while still valid. */
  async lookup(
    domain: string,
    signature: string,
    fields: readonly FieldSchema[],
    data: SourceData,
  ): Promise<FieldDecision[]> {
    const { [signature]: sameStep = [], ...otherSteps } = (await this.read())[domain] ?? {};
    // The same step wins; other steps of the portal cover fields that moved or appeared later.
    const entries = [...Object.values(otherSteps).flat(), ...sameStep];
    const byKey = new Map(entries.map((entry) => [entry.fieldKey, entry]));
    const decisions: FieldDecision[] = [];
    for (const field of fields) {
      const entry = byKey.get(fieldKey(field));
      if (!entry || field.error || !hasUsableLabel(field) || !stillFits(field, entry)) continue;
      if (hashSource(entry.source, data) !== entry.sourceHash) continue;
      decisions.push({
        fieldId: field.id,
        action: entry.action,
        confidence: 1,
        origin: 'cache',
        ...(entry.value !== undefined ? { value: entry.value } : {}),
        ...(entry.source ? { source: entry.source } : {}),
      });
    }
    return decisions;
  }

  async summary(): Promise<CacheSummary[]> {
    return Object.entries(await this.read())
      .map(([domain, steps]) => ({
        domain,
        steps: Object.keys(steps).length,
        fields: Object.values(steps).reduce((total, entries) => total + entries.length, 0),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }

  async clear(domain: string): Promise<void> {
    const { [domain]: _removed, ...rest } = await this.read();
    await this.store.set(STORAGE_KEY, rest);
  }

  private async read(): Promise<CacheData> {
    const parsed = cacheSchema.safeParse(await this.store.get(STORAGE_KEY));
    return parsed.success ? parsed.data : {};
  }
}
