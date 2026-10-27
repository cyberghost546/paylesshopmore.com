// The public blog: the index of articles and one article.
//
// jsdom reports an English browser, so these read the English dictionary.

import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getPost, listPosts } from '../../api/blog';
import { ApiError } from '../../api/client';
import Blog from './Blog';
import BlogPost from './BlogPost';
import { parseBody } from './parseBody';
import { slugify } from './slugify';

vi.mock('../../api/blog', async (importOriginal) => ({
  ...(await importOriginal()),
  listPosts: vi.fn(),
  getPost: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listPosts).mockReset();
  vi.mocked(getPost).mockReset();
});

function renderArticle(slug = 'sea-or-air-freight') {
  return renderWithProviders(
    <Routes>
      <Route path="/blog/:slug" element={<BlogPost />} />
    </Routes>,
    { route: `/blog/${slug}` },
  );
}

describe('the blog index', () => {
  it('shows one card per article, linking to it', async () => {
    vi.mocked(listPosts).mockResolvedValue([
      {
        slug: 'sea-or-air-freight',
        language: 'en',
        title: 'Sea or air?',
        summary: 'Which suits you.',
        cover: null,
        published_at: '2026-09-15T10:00:00Z',
      },
    ]);
    renderWithProviders(<Blog />);

    const card = await screen.findByRole('link', { name: /Sea or air\?/ });
    expect(card).toHaveAttribute('href', '/blog/sea-or-air-freight');
    expect(within(card).getByText('Which suits you.')).toBeInTheDocument();
    expect(within(card).getByText(/September 15, 2026/)).toBeInTheDocument();
    // Asked in the visitor's language.
    expect(listPosts).toHaveBeenCalledWith('en');
  });

  it('says so when there are no posts yet', async () => {
    vi.mocked(listPosts).mockResolvedValue([]);
    renderWithProviders(<Blog />);

    expect(await screen.findByText(/There are no posts yet/)).toBeInTheDocument();
  });
});

describe('one article', () => {
  it('shows the text with its headings and bullet points', async () => {
    vi.mocked(getPost).mockResolvedValue({
      slug: 'sea-or-air-freight',
      language: 'en',
      title: 'Sea or air?',
      summary: 'Which suits you.',
      cover: null,
      published_at: '2026-09-15T10:00:00Z',
      body: 'Intro line.\n\n## Sea freight\n- Aruba: 16 days\n- Curaçao: 17 days',
      languages: ['en', 'nl'],
    });
    renderArticle();

    expect(await screen.findByRole('heading', { level: 1, name: 'Sea or air?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sea freight' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Aruba: 16 days',
      'Curaçao: 17 days',
    ]);
    expect(getPost).toHaveBeenCalledWith('sea-or-air-freight', 'en');
    // In the visitor's own language: no note.
    expect(screen.queryByText(/has not been translated/)).toBeNull();
  });

  it('says when the article is shown in another language', async () => {
    vi.mocked(getPost).mockResolvedValue({
      slug: 'x',
      language: 'nl',
      title: 'Alleen Nederlands',
      summary: 'Kort.',
      body: 'Tekst.',
      cover: null,
      published_at: null,
      languages: ['nl'],
    });
    renderArticle('x');

    expect(
      await screen.findByText(/has not been translated \(yet\) and is shown here in Dutch/),
    ).toBeInTheDocument();
  });

  it('shows "not found" for an address with no article', async () => {
    vi.mocked(getPost).mockRejectedValue(new ApiError('not_found', null, 404));
    renderArticle('nope');

    expect(await screen.findByRole('heading', { name: 'Post not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All posts/ })).toHaveAttribute('href', '/blog');
  });
});

describe('the text rules', () => {
  it('turns empty lines, "## " and "- " into paragraphs, headings and lists', () => {
    expect(parseBody('One\ntwo.\n\n## Head\n- a\n- b\nAfter.')).toEqual([
      { type: 'paragraph', text: 'One two.' },
      { type: 'heading', text: 'Head' },
      { type: 'list', items: ['a', 'b'] },
      { type: 'paragraph', text: 'After.' },
    ]);
  });

  it('never treats the text as HTML', () => {
    expect(parseBody('<script>alert(1)</script>')).toEqual([
      { type: 'paragraph', text: '<script>alert(1)</script>' },
    ]);
  });

  it('makes a web address from a title', () => {
    expect(slugify('Zeevracht of luchtvracht: wat past bij u?')).toBe(
      'zeevracht-of-luchtvracht-wat-past-bij-u',
    );
    expect(slugify('Curaçao é Ñ!')).toBe('curacao-e-n');
  });
});
