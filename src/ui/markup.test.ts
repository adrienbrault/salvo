import { describe, expect, test } from 'bun:test';
import { ALL_ITEMS } from '../content/registry';
import { describe as describeItem } from '../content/types';
import { parseMarkup, stripMarkup } from './markup';

describe('markup', () => {
  test('splits text and tags in order', () => {
    expect(parseMarkup('Kill: {m:+8 Mult} and {b:+20 Shards}.')).toEqual([
      { kind: 'text', text: 'Kill: ' },
      { kind: 'm', text: '+8 Mult' },
      { kind: 'text', text: ' and ' },
      { kind: 'b', text: '+20 Shards' },
      { kind: 'text', text: '.' },
    ]);
  });

  test('keeps commas, symbols and apostrophes inside tags', () => {
    expect(parseMarkup('{g:+0.15}{$:−$1}{x:×2.5 Mult}{k:your ship’s action, 35%}')).toEqual([
      { kind: 'g', text: '+0.15' },
      { kind: '$', text: '−$1' },
      { kind: 'x', text: '×2.5 Mult' },
      { kind: 'k', text: 'your ship’s action, 35%' },
    ]);
  });

  test('leaves unknown or unclosed tags as literal text', () => {
    expect(parseMarkup('a {z:b} c {m:d')).toEqual([{ kind: 'text', text: 'a {z:b} c {m:d' }]);
    expect(parseMarkup('')).toEqual([]);
  });

  test('strips markup to plain text', () => {
    expect(stripMarkup('Interest cap {$:+$5}.')).toBe('Interest cap +$5.');
  });

  test('every item description parses without stray braces', () => {
    for (const def of ALL_ITEMS) {
      const text = describeItem(def, { uid: 1, id: def.id, state: {}, paid: def.price });
      for (const seg of parseMarkup(text)) {
        if (seg.kind === 'text') expect(seg.text).not.toMatch(/[{}]/);
      }
    }
  });
});
