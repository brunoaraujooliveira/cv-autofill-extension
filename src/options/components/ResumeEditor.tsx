import { useEffect, useState } from 'preact/hooks';
import exampleResume from '../../../examples/resume.example.json';
import { parseResumeJson, type ResumeIssue } from '../../shared/resume';
import { request } from '../../ui/api';
import { useApp } from '../../ui/app-context';
import { errorDetail, StatusLine, type Status } from './StatusLine';

const toJson = (value: unknown) => JSON.stringify(value, null, 2);

export function ResumeEditor() {
  const { locale, t } = useApp();
  const [json, setJson] = useState('');
  const [issues, setIssues] = useState<ResumeIssue[]>([]);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    request('resume/get', undefined)
      .then((resume) => {
        if (resume) setJson(toJson(resume));
      })
      .catch((error: unknown) => {
        setStatus({ kind: 'error', text: errorDetail(error) });
      });
  }, []);

  const edit = (next: string) => {
    setJson(next);
    setIssues([]);
    setStatus(null);
  };

  const format = () => {
    try {
      edit(toJson(JSON.parse(json)));
    } catch (error) {
      setIssues([
        { path: 'JSON', message: t('validation.invalidJson', { detail: errorDetail(error) }) },
      ]);
    }
  };

  const save = async () => {
    const parsed = parseResumeJson(json, locale);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      setStatus({ kind: 'error', text: t('resume.invalid') });
      return;
    }
    try {
      await request('resume/save', parsed.resume);
      setIssues([]);
      setStatus({ kind: 'ok', text: t('resume.valid') });
    } catch (error) {
      setStatus({ kind: 'error', text: t('options.error', { detail: errorDetail(error) }) });
    }
  };

  return (
    <section class="card">
      <h2>{t('resume.heading')}</h2>
      <p class="hint">{t('resume.hint')}</p>
      <textarea
        spellcheck={false}
        aria-label={t('resume.heading')}
        placeholder={t('resume.empty')}
        value={json}
        onInput={(event) => {
          edit(event.currentTarget.value);
        }}
      />
      <div class="actions">
        <button type="button" class="primary" onClick={() => void save()}>
          {t('resume.save')}
        </button>
        <button type="button" onClick={format}>
          {t('resume.format')}
        </button>
        <button
          type="button"
          onClick={() => {
            edit(toJson(exampleResume));
          }}
        >
          {t('resume.loadExample')}
        </button>
        <StatusLine status={status} />
      </div>
      {issues.length > 0 && (
        <ul class="issues">
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path}</code> — {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
