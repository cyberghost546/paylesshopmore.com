// Dashboard -> Quote requests -> an opened request: the answer box, with
// "Write with AI". The server is mocked.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { draftReplyToQuote, replyToQuote } from '../../api/staff';
import QuoteAnswer from './QuoteAnswer';
import { usePageText } from './usePageText';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  replyToQuote: vi.fn(),
  draftReplyToQuote: vi.fn(),
}));

const QUOTE = { id: 7, first_name: 'Anna', email: 'anna@example.com', status: 'new', replies: [] };

function Answer({ onUpdated }) {
  const d = usePageText('quotes');
  return <QuoteAnswer quote={QUOTE} onUpdated={onUpdated} d={d} />;
}

beforeEach(() => {
  replyToQuote.mockReset();
  draftReplyToQuote.mockReset();
});

describe('QuoteAnswer', () => {
  it('writes a draft with AI, and sends only when asked', async () => {
    draftReplyToQuote.mockResolvedValue({ body: 'Dear Anna, the price is [price].' });
    replyToQuote.mockResolvedValue({
      ...QUOTE,
      status: 'quoted',
      replies: [{ id: 1, body: 'Dear Anna, the price is EUR 240.', sent: true, created_at: '2026-10-26T09:00:00Z' }],
    });
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Answer onUpdated={onUpdated} />);

    await user.click(screen.getByRole('button', { name: 'Write with AI' }));
    const box = screen.getByRole('textbox', { name: 'Your answer to anna@example.com' });
    expect(await screen.findByText(/Fill in the \[price\]/)).toBeInTheDocument();
    expect(box).toHaveValue('Dear Anna, the price is [price].');
    expect(replyToQuote).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, 'Dear Anna, the price is EUR 240.');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(replyToQuote).toHaveBeenCalledWith(7, 'Dear Anna, the price is EUR 240.');
    expect(await screen.findByText(/Your answer was e-mailed to anna@example.com/)).toBeInTheDocument();
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'quoted' }));
  });

  it('does not offer a draft over text typed by hand', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Answer onUpdated={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Your answer to anna@example.com' }), 'Hi');
    expect(screen.getByRole('button', { name: 'Write with AI' })).toBeDisabled();
  });

  it('keeps the text and says so when the e-mail could not be sent', async () => {
    replyToQuote.mockResolvedValue({ ...QUOTE, replies: [{ id: 1, body: 'Hi', sent: false, created_at: '2026-10-26T09:00:00Z' }] });
    const user = userEvent.setup();
    renderWithProviders(<Answer onUpdated={vi.fn()} />);

    const box = screen.getByRole('textbox', { name: 'Your answer to anna@example.com' });
    await user.type(box, 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(await screen.findByText(/the e-mail could not be sent/)).toBeInTheDocument();
    expect(box).toHaveValue('Hi');
  });
});
