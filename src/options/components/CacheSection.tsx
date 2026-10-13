import { useEffect, useState } from 'preact/hooks';
import type { CacheSummary } from '../../shared/answers';
import { request } from '../../ui/api';
import { useApp } from '../../ui/app-context';

/** Shows which sites have learnt mappings and lets each one be forgotten. */
export function CacheSection() {
  const { t } = useApp();
  const [sites, setSites] = useState<CacheSummary[]>([]);

  useEffect(() => {
    void request('cache/list', undefined).then(setSites);
  }, []);

  return (
    <section class="card">
      <h2>{t('cache.heading')}</h2>
      <p class="hint">{t('cache.hint')}</p>
      {sites.length === 0 ? (
        <p>{t('cache.empty')}</p>
      ) : (
        <ul class="plain-list">
          {sites.map((site) => (
            <li key={site.domain} class="actions">
              <span>{t('cache.entry', { ...site })}</span>
              <button
                type="button"
                onClick={() => {
                  void request('cache/clear', { domain: site.domain }).then(setSites);
                }}
              >
                {t('cache.clear')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
