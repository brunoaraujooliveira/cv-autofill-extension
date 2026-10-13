import { useState } from 'preact/hooks';
import type { MessageKey } from '../../shared/i18n';
import { BUSY_PHASES } from '../../shared/run-machine';
import type { RunNotice, RunState } from '../../shared/types';
import { useApp } from '../../ui/app-context';
import { buildDiagnostics } from '../diagnostics';
import type { RunController } from '../use-run';
import { FieldList, summarize, toFieldRows } from './FieldList';

interface RunViewProps {
  controller: RunController;
  canStart: boolean;
}

function NoticeLine({ notice }: { notice: RunNotice }) {
  const { t } = useApp();
  const key: MessageKey = `run.notice.${notice.code}`;
  const missing = notice.code === 'next_disabled' ? notice.missing : [];
  return (
    <p class="status status--warning" data-notice={notice.code}>
      {t(key)}
      {missing.length > 0 && (
        <span class="detail">
          {' '}
          {t('run.notice.next_disabled.missing', { fields: missing.join(', ') })}
        </span>
      )}
    </p>
  );
}

/** Frames from other sites need the user's permission before they can be read. */
function BlockedFrames({ run, onGranted }: { run: RunState; onGranted: () => void }) {
  const { t } = useApp();
  const allow = (origin: string) => {
    chrome.permissions
      .request({ origins: [`${origin}/*`] })
      .then((granted) => {
        if (granted) onGranted();
      })
      .catch(() => undefined);
  };
  return (
    <>
      {(run.step?.blockedOrigins ?? []).map((origin) => (
        <p key={origin} class="status status--warning">
          {t('run.blocked', { origin })}{' '}
          <button
            type="button"
            onClick={() => {
              allow(origin);
            }}
          >
            {t('run.blocked.allow', { origin })}
          </button>
        </p>
      ))}
    </>
  );
}

export function RunView({ controller, canStart }: RunViewProps) {
  const { t } = useApp();
  const { run, actionError, start, confirm, finish, cancel, answer } = controller;
  const [jobDescription, setJobDescription] = useState('');
  const [copied, setCopied] = useState(false);
  const [includeValues, setIncludeValues] = useState(false);
  const copyDiagnostics = () => {
    if (!run) return;
    const text = buildDiagnostics(run, chrome.runtime.getManifest().version, { includeValues });
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  const phase = run?.phase ?? 'IDLE';
  const busy = BUSY_PHASES.has(phase);
  const phaseKey: MessageKey = `run.phase.${phase}`;
  const errorKey: MessageKey | null = run?.error ? `run.error.${run.error.code}` : null;
  const rows = run ? toFieldRows(run) : [];
  const idle = !canStart || busy;
  // After a reload the same button restores what was filled; otherwise it does the step over.
  const restoring = run?.notice?.code === 'page_reloaded';
  const read = () => {
    start({ jobDescription, redo: run?.step !== undefined && !restoring });
  };

  return (
    <>
      <section class="card" aria-busy={busy}>
        {run?.step && (
          <p class="step-title">
            {t('run.step', { number: run.stepNumber })}
            {run.step.title ? ` · ${run.step.title}` : ''}
          </p>
        )}
        <p class="status" data-phase={phase} role="status">
          {t(phaseKey)}
        </p>
        {errorKey && (
          <p class="status status--error">
            {t(errorKey)}
            {run?.error?.detail && <span class="detail"> {run.error.detail}</span>}
          </p>
        )}
        {actionError && (
          <p class="status status--error">{t('run.actionFailed', { detail: actionError })}</p>
        )}
        {run?.notice && <NoticeLine notice={run.notice} />}
        {!busy &&
          run?.shortfalls?.map((shortfall) => (
            <p key={shortfall.button} class="status status--warning" data-shortfall>
              {t('run.shortfall', { ...shortfall })}
            </p>
          ))}
        {run && <BlockedFrames run={run} onGranted={read} />}
        {rows.length > 0 && !busy && <p class="hint">{t('run.summary', summarize(rows))}</p>}

        <div class="actions">
          {busy && (
            <button type="button" onClick={cancel}>
              {t('run.stop')}
            </button>
          )}
          {phase === 'WAITING_USER_REVIEW' && (
            <button type="button" class="primary" disabled={idle} onClick={confirm}>
              {t('run.next')}
            </button>
          )}
          {phase === 'FINAL_REVIEW' && (
            <button type="button" class="primary" disabled={idle} onClick={finish}>
              {t('run.finish')}
            </button>
          )}
          <button
            type="button"
            class={run?.step && phase !== 'ERROR' ? '' : 'primary'}
            disabled={idle}
            title={run?.step && !restoring ? t('run.restart.hint') : undefined}
            onClick={read}
          >
            {t(run?.step ? 'run.restart' : 'run.start')}
          </button>
          {run?.step && (
            <button
              type="button"
              disabled={idle}
              onClick={() => {
                start({ jobDescription, fresh: true });
              }}
            >
              {t('run.fresh')}
            </button>
          )}
        </div>

        {run && (
          <p class="diagnostics">
            <button type="button" class="link" onClick={copyDiagnostics}>
              {t('run.diagnostics')}
            </button>
            {copied && <span class="hint"> {t('run.diagnostics.copied')}</span>}
            <label class="field field--inline diagnostics__values">
              <input
                type="checkbox"
                checked={includeValues}
                onChange={(event) => {
                  setIncludeValues(event.currentTarget.checked);
                  setCopied(false);
                }}
              />
              {t('run.diagnostics.values')}
            </label>
          </p>
        )}

        <details class="job-description">
          <summary>{t('run.jobDescription')}</summary>
          <p class="hint">{t('run.jobDescription.hint')}</p>
          <textarea
            rows={5}
            aria-label={t('run.jobDescription')}
            value={jobDescription}
            onInput={(event) => {
              setJobDescription(event.currentTarget.value);
            }}
          />
        </details>
      </section>
      {rows.length > 0 && <FieldList rows={rows} canAnswer={!busy} onAnswer={answer} />}
    </>
  );
}
