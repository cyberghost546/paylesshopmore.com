// Every sentence of the invoice pages exists in all three languages.
//
// A key missing in English or Papiamentu would quietly show Dutch (the
// fallback), so this test is what notices when somebody adds a sentence to
// one language and forgets the others.

import { describe, expect, it } from 'vitest';
import { invoiceTranslations } from './invoiceTranslations';

/** Every key path in a nested object: { a: { b: 'x' } } -> ['a.b']. */
function keys(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/** The {placeholders} in a sentence, sorted. */
function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function get(tree, path) {
  return path.split('.').reduce((value, key) => value?.[key], tree);
}

describe('invoice translations', () => {
  const dutch = keys(invoiceTranslations.nl);

  for (const language of ['en', 'pap']) {
    it(`${language} has every Dutch sentence, and no extra ones`, () => {
      expect(keys(invoiceTranslations[language]).sort()).toEqual([...dutch].sort());
    });

    it(`${language} keeps the same {placeholders} as Dutch`, () => {
      for (const path of dutch) {
        expect([path, placeholders(get(invoiceTranslations[language], path))]).toEqual([
          path,
          placeholders(get(invoiceTranslations.nl, path)),
        ]);
      }
    });
  }
});
