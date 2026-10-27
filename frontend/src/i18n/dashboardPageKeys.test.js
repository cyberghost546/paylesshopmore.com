// Every sentence an office or warehouse page asks for exists. A page reads its
// words as d('key') after `const d = usePageText('page')`; a key that is not in
// that page's translations would show up on screen as the raw key. This reads
// the page sources and checks each written-out key (and each group read as
// d(`group.${value}`)) against the English block, which the other test keeps
// in step with Dutch and Papiamentu.

import { describe, expect, it } from 'vitest';
import { dashboardPages } from './dashboardPageTranslations';

// The sources as text, so the keys can be read without running the pages.
const SOURCES = import.meta.glob(
  ['../pages/Dashboard/*.{js,jsx}', '../pages/Warehouse/*.{js,jsx}', '!**/*.test.*', '!**/usePageText.js'],
  { query: '?raw', import: 'default', eager: true },
);

const exists = (object, key) =>
  key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), object) !== undefined;

describe('keys used by the pages', () => {
  for (const [file, text] of Object.entries(SOURCES)) {
    const readers = [...text.matchAll(/const (\w+) = usePageText\('(\w+)'\)/g)];
    if (readers.length === 0) continue;

    it(`${file.replace('../pages/', '')}: every key it reads is translated`, () => {
      const missing = [];
      for (const [, name, page] of readers) {
        expect(dashboardPages[page], `page "${page}"`).toBeDefined();
        const english = dashboardPages[page].en;
        for (const [, key] of text.matchAll(new RegExp(`\\b${name}\\('([\\w.]+)'`, 'g'))) {
          if (!exists(english, key)) missing.push(`${page}.${key}`);
        }
        for (const [, group] of text.matchAll(new RegExp(`\\b${name}\\(\`(\\w+)\\.\\$\\{`, 'g'))) {
          if (!exists(english, group)) missing.push(`${page}.${group}.*`);
        }
      }
      expect(missing).toEqual([]);
    });
  }
});
