import type { RunState } from '../shared/types';

const MAX_OPTIONS = 15;

/**
 * Describes a run as text the user can paste into a bug report: what was read from the page,
 * what was decided and what happened. It carries the values filled in, so it is only ever
 * copied to the clipboard at the user's request.
 */
export function buildDiagnostics(run: RunState, version: string): string {
  const { step } = run;
  return JSON.stringify(
    {
      version,
      phase: run.phase,
      stepNumber: run.stepNumber,
      ...(run.error ? { error: run.error } : {}),
      ...(run.notice ? { notice: run.notice } : {}),
      step: step && {
        url: step.url,
        title: step.title,
        blockedOrigins: step.blockedOrigins,
        buttons: step.buttons,
        repeatables: step.repeatables,
        fields: step.fields.map((field) => ({
          ...field,
          ...(field.options
            ? { options: field.options.slice(0, MAX_OPTIONS), optionCount: field.options.length }
            : {}),
        })),
      },
      decisions: run.decisions,
      results: run.results,
      attempts: run.attempts,
      added: run.added,
      ...(run.shortfalls ? { shortfalls: run.shortfalls } : {}),
    },
    null,
    2,
  );
}
