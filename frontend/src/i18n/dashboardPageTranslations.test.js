// Every office page has the same sentences in every language, and the same
// {placeholders} in each translation of a sentence. Nested groups (option
// labels) are compared key by key too.

import { describe, expect, it } from 'vitest';
import { dashboardPages } from './dashboardPageTranslations';

const placeholders = (text) => (String(text).match(/\{\w+\}/g) ?? []).sort();

/** { a: { b: 'x' } } -> { 'a.b': 'x' } */
function flatten(object, prefix = '') {
  return Object.entries(object).reduce((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? { ...flat, ...flatten(value, path) } : { ...flat, [path]: value };
  }, {});
}

describe('dashboard page translations', () => {
  for (const [page, languages] of Object.entries(dashboardPages)) {
    it(`${page}: Dutch, English and Papiamentu have the same keys and placeholders`, () => {
      const english = flatten(languages.en);
      for (const language of ['nl', 'pap']) {
        const other = flatten(languages[language]);
        expect(Object.keys(other).sort(), `${page} ${language} keys`).toEqual(Object.keys(english).sort());
        for (const [key, text] of Object.entries(english)) {
          expect(placeholders(other[key]), `${page}.${key} in ${language}`).toEqual(placeholders(text));
          expect(String(other[key]).trim(), `${page}.${key} in ${language}`).not.toBe('');
        }
      }
    });
  }
});
