import { useEffect, useState } from 'preact/hooks';
import type { FileMeta } from '../../shared/answers';
import { request } from '../../ui/api';
import { useApp } from '../../ui/app-context';
import { errorDetail, StatusLine, type Status } from './StatusLine';

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the file'));
    };
    reader.readAsDataURL(file);
  });
}

/** Stores the resume document that gets attached to upload fields. */
export function ResumeFileSection() {
  const { t } = useApp();
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const fail = (error: unknown) => {
    setStatus({ kind: 'error', text: t('options.error', { detail: errorDetail(error) }) });
  };

  useEffect(() => {
    request('file/get', undefined).then(setMeta).catch(fail);
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: 'error', text: t('file.tooLarge') });
      return;
    }
    try {
      const payload = { name: file.name, type: file.type, base64: await toBase64(file) };
      setMeta(await request('file/save', payload));
      setStatus({ kind: 'ok', text: t('options.saved') });
    } catch (error) {
      fail(error);
    }
  };

  const remove = () => {
    request('file/remove', undefined)
      .then(() => {
        setMeta(null);
        setStatus(null);
      })
      .catch(fail);
  };

  return (
    <section class="card">
      <h2>{t('file.heading')}</h2>
      <p class="hint">{t('file.hint')}</p>
      <p data-testid="file-meta">
        {meta
          ? t('file.stored', { name: meta.name, size: Math.max(1, Math.round(meta.size / 1024)) })
          : t('file.none')}
      </p>
      <div class="actions">
        <input
          type="file"
          accept="application/pdf,.pdf,.doc,.docx"
          aria-label={t('file.choose')}
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        {meta && (
          <button type="button" onClick={remove}>
            {t('file.remove')}
          </button>
        )}
        <StatusLine status={status} />
      </div>
    </section>
  );
}
