import { useState } from 'preact/hooks';
import type { FieldDecision, FieldSchema } from '../../shared/types';
import { useApp } from '../../ui/app-context';

type AnswerValue = NonNullable<FieldDecision['value']>;

interface AnswerFormProps {
  field: FieldSchema;
  disabled: boolean;
  onAnswer: (value: AnswerValue) => void;
}

/** Lets the user answer, from the side panel, a field the extension could not fill by itself. */
export function AnswerForm({ field, disabled, onAnswer }: AnswerFormProps) {
  const { t } = useApp();
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(field.value === true);
  const label = `${t('field.answer')}: ${field.label}`;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (field.type === 'checkbox') onAnswer(checked);
    else if (text.trim() !== '') onAnswer(text.trim());
  };

  const control = () => {
    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          onChange={(event) => {
            setChecked(event.currentTarget.checked);
          }}
        />
      );
    }
    if (field.options?.length) {
      return (
        <select
          aria-label={label}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        >
          <option value="">{t('field.answer.choose')}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    const shared = {
      'aria-label': label,
      placeholder: field.placeholder ?? t('field.answer'),
      value: text,
      onInput: (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
        setText(event.currentTarget.value);
      },
    };
    return field.type === 'textarea' ? (
      <textarea rows={3} {...shared} />
    ) : (
      <input type="text" {...shared} />
    );
  };

  return (
    <form class="answer-form" onSubmit={submit}>
      {control()}
      <button type="submit" disabled={disabled}>
        {t('field.answer.save')}
      </button>
    </form>
  );
}
