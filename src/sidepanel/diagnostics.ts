import type { FieldDecision, RunState } from '../shared/types';

const MAX_OPTIONS = 15;

export interface DiagnosticsOptions {
  /** Keep what was typed into the form and the full address. Off unless the user asks. */
  includeValues: boolean;
}

/** Says what kind of value was there without saying what it was. */
function describeValue(value: FieldDecision['value']): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return '<yes/no>';
  if (Array.isArray(value)) return `<${value.length} choices>`;
  return value === '' ? '' : `<${value.length} characters>`;
}

function withoutQuery(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return '<address>';
  }
}

/**
 * Describes a run as text the user can paste into a bug report: what was read from the page,
 * what was decided and what happened. Reports get pasted into public places, so by default it
 * leaves out the values that went into the form and the address's query, which often carries
 * a personal token.
 */
export function buildDiagnostics(
  run: RunState,
  version: string,
  { includeValues }: DiagnosticsOptions = { includeValues: false },
): string {
  const { step } = run;
  const shown = <T extends FieldDecision['value']>(value: T) =>
    includeValues ? value : describeValue(value);

  return JSON.stringify(
    {
      version,
      phase: run.phase,
      stepNumber: run.stepNumber,
      ...(run.error ? { error: run.error } : {}),
      ...(run.notice ? { notice: run.notice } : {}),
      step: step && {
        url: includeValues ? step.url : withoutQuery(step.url),
        title: step.title,
        looksFinal: step.looksFinal,
        blockedOrigins: step.blockedOrigins,
        buttons: step.buttons,
        repeatables: step.repeatables,
        fields: step.fields.map((field) => ({
          ...field,
          value: shown(field.value),
          ...(field.options
            ? { options: field.options.slice(0, MAX_OPTIONS), optionCount: field.options.length }
            : {}),
        })),
      },
      decisions: run.decisions.map((decision) => ({
        ...decision,
        ...(decision.value !== undefined ? { value: shown(decision.value) } : {}),
      })),
      results: run.results,
      attempts: run.attempts,
      added: run.added,
      ...(run.shortfalls ? { shortfalls: run.shortfalls } : {}),
    },
    null,
    2,
  );
}
