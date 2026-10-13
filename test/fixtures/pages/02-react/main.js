import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  country: '',
  euAuthorized: '',
  remote: false,
  about: '',
};

/**
 * Every control is controlled: what gets submitted is the React state, not the DOM. A value
 * written to the DOM without the right events never reaches the state.
 */
function Application() {
  const [form, setForm] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(null);
  const set = (key) => (event) => {
    const { type, checked, value } = event.target;
    setForm((current) => ({ ...current, [key]: type === 'checkbox' ? checked : value }));
  };
  const text = (key, label, type = 'text') =>
    h('label', { key }, label, h('input', { type, value: form[key], onChange: set(key) }));

  return h(
    'form',
    {
      onSubmit: (event) => {
        event.preventDefault();
        setSubmitted(form);
      },
    },
    text('firstName', 'First name'),
    text('lastName', 'Last name'),
    text('email', 'Email', 'email'),
    h(
      'label',
      null,
      'Country',
      h(
        'select',
        { value: form.country, onChange: set('country') },
        h('option', { value: '' }, 'Select…'),
        h('option', { value: 'BR' }, 'Brazil'),
        h('option', { value: 'PT' }, 'Portugal'),
      ),
    ),
    h(
      'fieldset',
      null,
      h('legend', null, 'Are you authorized to work in the EU?'),
      ['Yes', 'No'].map((option) =>
        h(
          'label',
          { key: option },
          h('input', {
            type: 'radio',
            name: 'euAuthorized',
            value: option,
            checked: form.euAuthorized === option,
            onChange: set('euAuthorized'),
          }),
          option,
        ),
      ),
    ),
    h(
      'label',
      null,
      h('input', { type: 'checkbox', checked: form.remote, onChange: set('remote') }),
      'Open to remote work',
    ),
    h('label', null, 'About you', h('textarea', { value: form.about, onChange: set('about') })),
    h('button', { type: 'submit' }, 'Submit application'),
    h('pre', { id: 'result' }, submitted ? JSON.stringify(submitted) : ''),
  );
}

createRoot(document.getElementById('root')).render(h(Application));
