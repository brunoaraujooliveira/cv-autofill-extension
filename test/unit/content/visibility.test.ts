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
    ['full transparency', '<input id="target" style="opacity:0" />'],
    ['a fully transparent ancestor', '<div style="opacity:0"><p><input id="target" /></p></div>'],
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

  it('accepts partial transparency', () => {
    expect(visible('<input id="target" style="opacity:0.4" />')).toBe(true);
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
  const boxAt = (left: number, top: number, width: number, height: number) => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    return hasLayoutBox(element);
  };

  it('accepts a box with real size on the page', () => {
    expect(boxAt(10, 10, 120, 24)).toBe(true);
    expect(boxAt(10, 5000, 120, 24)).toBe(true);
  });

  it('rejects boxes collapsed to nothing or to a sliver', () => {
    expect(boxAt(10, 10, 0, 24)).toBe(false);
    expect(boxAt(10, 10, 120, 0)).toBe(false);
    expect(boxAt(10, 10, 1, 1)).toBe(false);
  });

  it('rejects boxes parked off the top or left of the page', () => {
    expect(boxAt(-9999, 10, 120, 24)).toBe(false);
    expect(boxAt(10, -9999, 120, 24)).toBe(false);
  });
});
