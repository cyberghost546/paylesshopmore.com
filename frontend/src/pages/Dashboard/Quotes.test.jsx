// Dashboard -> Quote requests: a request opens in a pop-up with everything
// in it - the request, the contact details, the message and the answer box.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { listQuotes, updateQuote } from '../../api/staff';
import Quotes from './Quotes';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  listQuotes: vi.fn(),
  updateQuote: vi.fn(),
}));

const QUOTE = {
  id: 33,
  full_name: 'Maria Martina',
  first_name: 'Maria',
  last_name: 'Martina',
  email: 'maria.martina@demo.invalid',
  destination: 'Curaçao',
  message: 'Wat kost ongeveer 6 kg aan boeken en speelgoed?',
  status: 'new',
  status_display: 'New',
  language: 'nl',
  file_url: null,
  created_at: '2026-10-09T09:19:00Z',
  updated_at: '2026-10-09T09:19:00Z',
  replies: [],
};

beforeEach(() => {
  listQuotes.mockReset().mockResolvedValue({ results: [QUOTE], count: 1 });
  updateQuote.mockReset();
});

describe('Quotes', () => {
  it('opens a request in a pop-up, with the answer box, and closes it again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Quotes />);

    await user.click(await screen.findByRole('button', { name: 'Maria Martina' }));

    const dialog = screen.getByRole('dialog', { name: 'Maria Martina' });
    expect(within(dialog).getByText('Wat kost ongeveer 6 kg aan boeken en speelgoed?')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Your answer to maria.martina@demo.invalid' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Write with AI' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a request with a file, no message and no known language', async () => {
    listQuotes.mockResolvedValue({
      results: [{ ...QUOTE, message: '', language: '', file_url: '/api/staff/quotes/33/file/', file_name: 'lijst.pdf' }],
      count: 1,
    });
    const user = userEvent.setup();
    renderWithProviders(<Quotes />);

    await user.click(await screen.findByRole('button', { name: 'Maria Martina' }));
    const dialog = screen.getByRole('dialog', { name: 'Maria Martina' });
    expect(within(dialog).getByText('No message')).toBeInTheDocument();
    expect(within(dialog).getByText('Not known')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /lijst\.pdf/ })).toHaveAttribute('href', '/api/staff/quotes/33/file/');
  });

  it('changes the status from the list, and says so when that fails', async () => {
    updateQuote.mockResolvedValueOnce({ ...QUOTE, status: 'quoted', status_display: 'Quote sent' });
    const user = userEvent.setup();
    renderWithProviders(<Quotes />);

    const select = await screen.findByLabelText('Status for Maria Martina');
    await user.selectOptions(select, 'quoted');
    expect(updateQuote).toHaveBeenCalledWith(33, { status: 'quoted' });

    updateQuote.mockRejectedValueOnce(new Error('offline'));
    await user.selectOptions(select, 'accepted');
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument();
  });

  it('says so when nothing matches, and filters by status', async () => {
    listQuotes.mockResolvedValue({ results: [], count: 0 });
    const user = userEvent.setup();
    renderWithProviders(<Quotes />);

    expect(await screen.findByText('No quote requests match that.')).toBeInTheDocument();
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'new');
    expect(listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'new' }));
  });
});
