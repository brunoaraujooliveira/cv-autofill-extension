import { beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../../../src/content/dom';
import { fillCombobox, harvestOptions } from '../../../src/content/filler/combobox';
import { ALWAYS_HAS_BOX, render } from './helpers';

const CONTEXT = { hasBox: ALWAYS_HAS_BOX, timeoutMs: 200 };
const CITIES = ['Lisbon', 'Porto', 'São Paulo', 'Portland'];

/**
 * A minimal searchable combobox following the ARIA pattern: the popup only exists while open,
 * typing filters it, and picking an option closes it.
 */
function mountCombobox({ opensOn = 'mousedown' }: { opensOn?: 'mousedown' | 'ArrowDown' } = {}) {
  render(`<div><input role="combobox" aria-expanded="false" aria-controls="cities" /></div>`);
  const input = document.querySelector('input') as HTMLInputElement;
  const state = { selected: '' };

  const close = () => {
    document.querySelector('#cities')?.remove();
    input.setAttribute('aria-expanded', 'false');
  };
  const renderOptions = () => {
    close();
    const list = document.createElement('ul');
    list.id = 'cities';
    list.setAttribute('role', 'listbox');
    for (const city of CITIES.filter((c) => c.toLowerCase().includes(input.value.toLowerCase()))) {
      const option = document.createElement('li');
      option.setAttribute('role', 'option');
      option.textContent = city;
      option.addEventListener('click', () => {
        state.selected = city;
        close();
      });
      list.append(option);
    }
    document.body.append(list);
    input.setAttribute('aria-expanded', 'true');
  };

  if (opensOn === 'mousedown') input.addEventListener('mousedown', renderOptions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') renderOptions();
    if (event.key === 'Escape') close();
  });
  input.addEventListener('input', renderOptions);
  return { input, state };
}

describe('combobox driver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the popup to read the options and closes it again', async () => {
    const { input } = mountCombobox();
    expect(await harvestOptions(input, CONTEXT)).toEqual(CITIES);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('falls back to the keyboard when clicking does not open the popup', async () => {
    const { input } = mountCombobox({ opensOn: 'ArrowDown' });
    expect(await harvestOptions(input, CONTEXT)).toEqual(CITIES);
  });

  it('returns nothing when the popup never shows options', async () => {
    render('<input role="combobox" />');
    const input = document.querySelector('input') as HTMLInputElement;
    expect(await harvestOptions(input, CONTEXT)).toEqual([]);
  });

  it('clicks the matching option, ignoring case and accents', async () => {
    const { input, state } = mountCombobox();
    await fillCombobox(input, 'sao paulo', CONTEXT);
    expect(state.selected).toBe('São Paulo');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('types to filter when the wanted option is not an exact match of what is listed', async () => {
    const { input, state } = mountCombobox();
    await fillCombobox(input, 'Lisb', CONTEXT);
    expect(state.selected).toBe('Lisbon');
  });

  it('fails without selecting anything when the text matches several options or none', async () => {
    const { input, state } = mountCombobox();

    await expect(fillCombobox(input, 'Port', CONTEXT)).rejects.toThrow('No option matches "Port"');
    await expect(fillCombobox(input, 'Madrid', CONTEXT)).rejects.toThrow('No option matches');

    expect(state.selected).toBe('');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('waitFor', () => {
  it('resolves as soon as a mutation makes the probe truthy', async () => {
    document.body.innerHTML = '';
    const found = waitFor(() => document.querySelector('.late'), { timeoutMs: 1000 });
    const element = document.createElement('p');
    element.className = 'late';
    document.body.append(element);
    expect(await found).toBe(element);
  });

  it('resolves with null when the safety timeout is reached', async () => {
    expect(await waitFor(() => document.querySelector('.never'), { timeoutMs: 20 })).toBeNull();
  });
});
