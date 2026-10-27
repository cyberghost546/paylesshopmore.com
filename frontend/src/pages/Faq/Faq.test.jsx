// The FAQ page lists its topics and questions in faqContent.js and looks
// their words up in translations.js. What is worth pinning down: every
// question listed there has its words in all three languages, the topics
// fold open, and the old company name never comes back.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { translations } from '../../i18n/translations';
import { FAQ_CATEGORIES } from './faqContent';
import Faq from './Faq';

describe('the FAQ page', () => {
  it('opens with the title and a way back to the home page', () => {
    renderWithProviders(<Faq />, { route: '/faq' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Frequently asked questions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('shows every topic, with only the first one open', () => {
    const { container } = renderWithProviders(<Faq />, { route: '/faq' });
    const topics = container.querySelectorAll('details');

    expect([...topics].map((topic) => topic.querySelector('summary').textContent)).toEqual([
      'Shipping goods',
      'Shipping a car',
      'Pick up & deliver goods',
      'Packing goods',
      'Local costs',
      'Insurance',
      'Pay',
    ]);
    expect([...topics].map((topic) => topic.open)).toEqual([
      true, false, false, false, false, false, false,
    ]);
  });

  it('opens a topic when its title is clicked', async () => {
    const { container } = renderWithProviders(<Faq />, { route: '/faq' });
    const car = container.querySelectorAll('details')[1];

    await userEvent.click(within(car).getByText('Shipping a car'));

    expect(car.open).toBe(true);
    expect(within(car).getByText('Does Pay Less Shop More also pick up my car?')).toBeInTheDocument();
  });

  it('fills in our own address and never names the old company', () => {
    const { container } = renderWithProviders(<Faq />, { route: '/faq' });

    expect(
      screen.getByText(/receive you at our office at Hertzstraat 10, 2652 XX Berkel en Rodenrijs/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Carib|Intertrans|\{address\}/);
  });

  it('links questions to the right page', () => {
    renderWithProviders(<Faq />, { route: '/faq' });

    expect(screen.getByRole('link', { name: /See the destinations/ })).toHaveAttribute(
      'href',
      '/destinations',
    );
    expect(screen.getByRole('link', { name: /Book a shipment/ })).toHaveAttribute(
      'href',
      '/booking',
    );
  });

  it('shows the documents customs asks for', () => {
    renderWithProviders(<Faq />, { route: '/faq' });
    const box = screen.getByRole('complementary', { name: 'Important when shipping goods' });

    expect(within(box).getAllByRole('listitem')).toHaveLength(3);
  });

  it.each(['nl', 'en', 'pap'])('has every listed question in %s', (language) => {
    const faq = translations[language].faq;

    for (const category of FAQ_CATEGORIES) {
      const words = faq.categories[category.id];
      expect(words?.title, `${language} ${category.id}`).toBeTruthy();
      for (const question of category.questions) {
        const text = words.questions[question.id];
        expect(text?.q, `${language} ${category.id}.${question.id}`).toBeTruthy();
        expect(text?.a, `${language} ${category.id}.${question.id}`).toBeTruthy();
        if (question.link) expect(text.link).toBeTruthy();
      }
      // Nothing in translations.js that the page never shows.
      expect(Object.keys(words.questions).sort()).toEqual(
        category.questions.map((question) => question.id).sort(),
      );
    }
    expect(Object.keys(faq.categories).sort()).toEqual(
      FAQ_CATEGORIES.map((category) => category.id).sort(),
    );
  });
});
