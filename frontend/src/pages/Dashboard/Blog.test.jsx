// The dashboard's Blog page: the office writes, publishes and deletes posts.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { createPost, deletePost, listAllPosts, updatePost } from '../../api/blog';
import Blog from './Blog';

vi.mock('../../api/blog', async (importOriginal) => ({
  ...(await importOriginal()),
  listAllPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
}));

const POST = {
  id: 5,
  slug: 'sea-or-air-freight',
  language: 'en',
  title: 'Sea or air?',
  summary: 'Which suits you.',
  body: 'Text.',
  is_published: true,
  published_at: '2026-09-15T10:00:00Z',
  author_name: 'Olga Office',
  cover_url: null,
};

beforeEach(() => {
  vi.mocked(listAllPosts).mockReset().mockResolvedValue([POST]);
  vi.mocked(createPost).mockReset().mockResolvedValue({});
  vi.mocked(updatePost).mockReset().mockResolvedValue({});
  vi.mocked(deletePost).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the dashboard Blog page', () => {
  it('lists the posts with their status', async () => {
    renderWithProviders(<Blog />);

    const row = (await screen.findByText('Sea or air?')).closest('tr');
    expect(within(row).getByText('Published')).toBeInTheDocument();
    expect(within(row).getByText('/blog/sea-or-air-freight')).toBeInTheDocument();
    expect(within(row).getByText('Olga Office')).toBeInTheDocument();
  });

  it('writes a new post, with the address made from the title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Blog />);
    await screen.findByText('Sea or air?');

    await user.click(screen.getByRole('button', { name: 'New post' }));
    await user.type(screen.getByLabelText('Title'), 'Hoe werkt de douane?');
    expect(screen.getByLabelText(/Address/)).toHaveValue('hoe-werkt-de-douane');

    await user.selectOptions(screen.getByLabelText('Language'), 'nl');
    await user.type(screen.getByLabelText(/Summary/), 'Kort.');
    await user.type(screen.getByLabelText('Text'), '## Kop{enter}- punt');
    // The live preview shows the heading and the bullet point.
    expect(screen.getByRole('heading', { name: 'Kop' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save post' }));

    expect(createPost).toHaveBeenCalledWith({
      title: 'Hoe werkt de douane?',
      slug: 'hoe-werkt-de-douane',
      language: 'nl',
      summary: 'Kort.',
      body: '## Kop\n- punt',
      is_published: false,
    });
    expect(await screen.findByText(/is saved as a draft/)).toBeInTheDocument();
  });

  it('edits a post with its current text filled in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Blog />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Sea or air?');
    expect(screen.getByLabelText(/Published/)).toBeChecked();

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Sea or air freight?');
    // An existing post keeps its address when the title changes.
    expect(screen.getByLabelText(/Address/)).toHaveValue('sea-or-air-freight');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updatePost).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Sea or air freight?' }));
  });

  it('asks before deleting', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<Blog />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(deletePost).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deletePost).toHaveBeenCalledWith(5);
  });
});
