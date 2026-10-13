import { useEffect, useState } from 'preact/hooks';
import type { AnswerEntry } from '../../shared/answers';
import { request } from '../../ui/api';
import { useApp } from '../../ui/app-context';

const asText = (answer: AnswerEntry['answer']) =>
  Array.isArray(answer) ? answer.join(', ') : answer;

function AnswerItem({
  entry,
  onChange,
}: {
  entry: AnswerEntry;
  onChange: (entries: AnswerEntry[]) => void;
}) {
  const { t } = useApp();
  const [text, setText] = useState(asText(entry.answer));

  return (
    <li class="answer-item">
      <label class="field">
        {entry.question}
        <input
          type="text"
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value);
          }}
        />
      </label>
      <div class="actions">
        <button
          type="button"
          disabled={text.trim() === '' || text === asText(entry.answer)}
          onClick={() => {
            void request('answers/save', { id: entry.id, answer: text.trim() }).then(onChange);
          }}
        >
          {t('answers.save')}
        </button>
        <button
          type="button"
          onClick={() => {
            void request('answers/remove', { id: entry.id }).then(onChange);
          }}
        >
          {t('answers.remove')}
        </button>
      </div>
    </li>
  );
}

/** Lists the answers kept for questions the resume does not cover, to edit or delete them. */
export function AnswersSection() {
  const { t } = useApp();
  const [entries, setEntries] = useState<AnswerEntry[]>([]);

  useEffect(() => {
    void request('answers/list', undefined).then(setEntries);
  }, []);

  return (
    <section class="card">
      <h2>{t('answers.heading')}</h2>
      <p class="hint">{t('answers.hint')}</p>
      {entries.length === 0 ? (
        <p>{t('answers.empty')}</p>
      ) : (
        <ul class="plain-list">
          {entries.map((entry) => (
            <AnswerItem
              key={`${entry.id}:${entry.updatedAt}`}
              entry={entry}
              onChange={setEntries}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
