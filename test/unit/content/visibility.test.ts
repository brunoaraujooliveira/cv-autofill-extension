import { describe, expect, it } from 'vitest';
import { hasLayoutBox, isVisible } from '../../../src/content/extractor/visibility';
import { ALWAYS_HAS_BOX, render } from './helpers';

function visible(html: string, hasBox = ALWAYS_HAS_BOX): boolean {
  render(html);
  const target = document.querySelector('#target');
  if (!target) throw new Error('Missing #target');
  return isVisible(target, hasBox);
}

describe('isVisible', () => {
  it('accepts a plain element', () => {
    expect(visible('<input id="target" />')).toBe(true);
  });

  it.each([
    ['display:none on the element', '<input id="target" style="display:none" />'],
    ['display:none on an ancestor', '<div style="display:none"><p><input id="target" /></p></div>'],
    ['visibility:hidden', '<input id="target" style="visibility:hidden" />'],
    ['visibility:hidden inherited', '<div style="visibility:hidden"><input id="target" /></div>'],
    ['the hidden attribute', '<div hidden><input id="target" /></div>'],
    ['aria-hidden', '<div aria-hidden="true"><input id="target" /></div>'],
    ['an inert ancestor', '<div inert><input id="target" /></div>'],
    [
      'an inactive tab panel',
      '<div role="tabpanel" hidden><fieldset><input id="target" /></fieldset></div>',
    ],
  ])('rejects %s', (_, html) => {
    expect(visible(html)).toBe(false);
  });

  it('accepts a visible child of a hidden-visibility ancestor that overrides it', () => {
    expect(
      visible(
        '<div style="visibility:hidden"><input id="target" style="visibility:visible" /></div>',
      ),
    ).toBe(true);
  });

  it('rejects elements with no size', () => {
    expect(visible('<input id="target" />', () => false)).toBe(false);
  });

  it('follows the host when the element lives in an open shadow root', () => {
    render('<div id="host" hidden></div>');
    const host = document.querySelector('#host');
    const shadow = host?.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow?.append(input);
    expect(isVisible(input, ALWAYS_HAS_BOX)).toBe(false);
    host?.removeAttribute('hidden');
    expect(isVisible(input, ALWAYS_HAS_BOX)).toBe(true);
  });
});

describe('hasLayoutBox', () => {
  it('requires both width and height', () => {
    const element = document.createElement('div');
    const withRect = (width: number, height: number) => {
      element.getBoundingClientRect = () => ({ width, height }) as DOMRect;
      return hasLayoutBox(element);
    };
    expect(withRect(10, 10)).toBe(true);
    expect(withRect(0, 10)).toBe(false);
    expect(withRect(10, 0)).toBe(false);
  });
});
