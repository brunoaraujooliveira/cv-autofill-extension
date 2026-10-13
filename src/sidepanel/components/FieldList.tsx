import type { MessageKey, Translate } from '../../shared/i18n';
import type {
  FieldDecision,
  FieldSchema,
  FieldValue,
  FillResult,
  RunState,
} from '../../shared/types';
import { useApp } from '../../ui/app-context';
import { AnswerForm } from './AnswerForm';

type RowStatus = FillResult['status'] | 'ask_user' | 'skip';

export interface FieldRow {
  field: FieldSchema;
  decision: FieldDecision | undefined;
  status: RowStatus;
  error?: string;
}

const NEEDS_USER: ReadonlySet<RowStatus> = new Set(['ask_user', 'failed', 'pending_manual']);

function statusOf(decision: FieldDecision | undefined, result: FillResult | undefined): RowStatus {
  if (result) return result.status;
  if (decision?.action === 'ask_user') return 'ask_user';
  // Decided earlier and still on the page: nothing had to be done this time.
  return decision?.action === 'fill' ? 'filled' : 'skip';
}

/** Joins what was read, what was decided and what happened into one row per field. */
export function toFieldRows(run: RunState): FieldRow[] {
  const decisions = new Map(run.decisions.map((decision) => [decision.fieldId, decision]));
  const results = new Map(run.results.map((result) => [result.fieldId, result]));
  return (run.step?.fields ?? []).map((field) => {
    const decision = decisions.get(field.id);
    const result = results.get(field.id);
    const error = result?.error ?? field.error;
    return { field, decision, status: statusOf(decision, result), ...(error ? { error } : {}) };
  });
}

export function summarize(rows: readonly FieldRow[]) {
  return {
    filled: rows.filter((row) => row.status === 'filled').length,
    pending: rows.filter((row) => NEEDS_USER.has(row.status)).length,
    skipped: rows.filter((row) => row.status === 'skip').length,
  };
}

function formatValue(value: FieldDecision['value'], t: Translate): string {
  if (typeof value === 'boolean') return t(value ? 'field.yes' : 'field.no');
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

interface FieldItemProps {
  row: FieldRow;
  canAnswer: boolean;
  onAnswer: (fieldId: string, value: FieldValue) => void;
}

function FieldItem({ row, canAnswer, onAnswer }: FieldItemProps) {
  const { t } = useApp();
  const { field, decision, status } = row;
  const statusKey: MessageKey = `field.status.${status}`;
  const group = field.group ? `${field.group.label} · ` : '';
  const answerable = NEEDS_USER.has(status) && field.type !== 'file';

  return (
    <li class={`field-row field-row--${status}`} data-field-id={field.id} data-status={status}>
      <div class="field-row__head">
        <span class="field-row__label">
          {group}
          {field.label || t('field.unlabeled')}
          {field.required && <span class="field-row__required"> · {t('field.required')}</span>}
        </span>
        <span class="badge">{t(statusKey)}</span>
      </div>
      {decision?.action === 'fill' && (
        <p class="field-row__value">{formatValue(decision.value, t)}</p>
      )}
      <p class="field-row__meta">
        {decision?.needsReview && <span class="badge badge--review">{t('field.needsReview')}</span>}
        {decision?.origin === 'cache' && <span class="badge">{t('field.origin.cache')}</span>}
        {decision?.origin === 'user' && <span class="badge">{t('field.origin.user')}</span>}
        {decision?.action === 'fill' && decision.origin === 'llm' && (
          <span>{t('field.confidence', { percent: Math.round(decision.confidence * 100) })}</span>
        )}
        {decision?.reason && <span>{decision.reason}</span>}
      </p>
      {row.error && <p class="field-row__error">{row.error}</p>}
      {answerable && (
        <AnswerForm
          field={field}
          disabled={!canAnswer}
          onAnswer={(value) => {
            onAnswer(field.id, value);
          }}
        />
      )}
    </li>
  );
}

interface FieldListProps {
  rows: readonly FieldRow[];
  canAnswer: boolean;
  onAnswer: (fieldId: string, value: FieldValue) => void;
}

export function FieldList({ rows, canAnswer, onAnswer }: FieldListProps) {
  // Fields that need the user come first: they are what the review is for.
  const ordered = [...rows].sort(
    (a, b) => Number(NEEDS_USER.has(b.status)) - Number(NEEDS_USER.has(a.status)),
  );
  return (
    <ul class="field-list">
      {ordered.map((row) => (
        <FieldItem key={row.field.id} row={row} canAnswer={canAnswer} onAnswer={onAnswer} />
      ))}
    </ul>
  );
}
