// The terms page shows legal text from src/data/terms.js. What is worth
// pinning down: every Article/Section is on the page and reachable from the
// contents, the old company name never comes back, and the translated frame
// around the (English) conditions exists in all three languages.

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { translations } from '../../i18n/translations';
import { FORWARDING, WAREHOUSING } from '../../data/terms';
import Terms from './Terms';

const forwardingArticles = FORWARDING.groups.flatMap((group) => group.articles);
const warehousingSections = WAREHOUSING.parts.flatMap((part) => part.sections);

describe('the terms page', () => {
  it('opens with the title, a way home and the note about the language', () => {
    renderWithProviders(<Terms />, { route: '/terms' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Terms and conditions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('note')).toHaveTextContent(/Dutch text prevails/);
  });

  it('shows both sets of conditions, in English', () => {
    renderWithProviders(<Terms />, { route: '/terms' });

    for (const doc of [FORWARDING, WAREHOUSING]) {
      const heading = screen.getByRole('heading', { level: 2, name: doc.title });
      expect(heading.closest('article')).toHaveAttribute('lang', 'en');
    }
  });

  it('has every Article and Section, each linked from the contents', () => {
    renderWithProviders(<Terms />, { route: '/terms' });
    const contents = screen.getByRole('navigation', { name: 'Contents' });

    expect(forwardingArticles.map((a) => a.number)).toEqual(
      Array.from({ length: 22 }, (_, i) => i + 1),
    );

    for (const [doc, items, label] of [
      [FORWARDING, forwardingArticles, 'Article'],
      [WAREHOUSING, warehousingSections, 'Section'],
    ]) {
      for (const item of items) {
        const id = `${doc.id}-${item.number}`;
        expect(document.getElementById(id)).not.toBeNull();
        // Found by address rather than by role and name: asking for 73 links
        // by accessible name is slow enough to time out under the full suite.
        const link = contents.querySelector(`a[href="#${id}"]`);
        expect(link?.textContent).toBe(
          `${item.kind === 'article' ? 'Article' : label} ${item.number}. ${item.title}`,
        );
      }
    }
  });

  it('numbers the paragraphs of a Forwarding Article, as the text refers to them', () => {
    renderWithProviders(<Terms />, { route: '/terms' });

    // Article 11 has twelve paragraphs; "paragraph 3" must be findable.
    const article = document.getElementById('forwarding-11');
    expect(within(article).getAllByRole('listitem')).toHaveLength(12);
  });

  it('names Pay Less Shop More and never the old company', () => {
    renderWithProviders(<Terms />, { route: '/terms' });
    const text = document.body.textContent;

    expect(text).toContain('Forwarding Conditions Pay Less Shop More');
    expect(text).toContain('Hertzstraat 10');
    expect(text).not.toMatch(/Carib|Intertrans|Molenbaan|66993539/i);
  });

  it('has the Warehousing Conditions in full, Chapter II included', () => {
    renderWithProviders(<Terms />, { route: '/terms' });

    expect(WAREHOUSING.complete).toBe(true);
    expect(warehousingSections.map((s) => s.number)).toEqual(
      Array.from({ length: 51 }, (_, i) => i + 1),
    );
    expect(screen.queryByText(/rest of these conditions will be added/)).toBeNull();
    expect(screen.getByText(/Opslagvoorwaarden/)).toBeInTheDocument();
  });

  it('letters the list in Section 37.1, which the text refers to as "d. and e."', () => {
    renderWithProviders(<Terms />, { route: '/terms' });

    const section = document.getElementById('warehousing-37');
    const lettered = section.querySelector('ol');
    expect(lettered.children).toHaveLength(6);
    expect(within(lettered.children[4]).getByText(/e\.1 for preserving/)).toBeInTheDocument();
  });

  it('has the page frame in every language', () => {
    const keys = (language) => Object.keys(translations[language].terms).sort();

    expect(keys('nl')).toEqual(keys('en'));
    expect(keys('pap')).toEqual(keys('en'));
  });
});
