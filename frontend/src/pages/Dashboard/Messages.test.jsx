// Dashboard -> Messages: "Read all" (or a click on the row) opens the whole
// message in a pop-up, with a reply box, a mail link and "Mark handled" inside.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { draftReplyToMessage, listMessages, replyToMessage, sortMessages, updateMessage } from '../../api/staff';
import Messages from './Messages';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  listMessages: vi.fn(),
  updateMessage: vi.fn(),
  replyToMessage: vi.fn(),
  draftReplyToMessage: vi.fn(),
  sortMessages: vi.fn(),
}));

const MESSAGE = {
  id: 4,
  name: 'chris',
  email: 'chris@chris.com',
  subject: 'General question',
  message: 'First line of the message.\nSecond line, which the table cuts off.',
  language: 'en',
  handled: false,
  created_at: '2026-09-18T10:39:00Z',
};

beforeEach(() => {
  listMessages.mockReset().mockResolvedValue({ results: [MESSAGE], count: 1 });
  updateMessage.mockReset().mockResolvedValue({ ...MESSAGE, handled: true });
  replyToMessage.mockReset();
  draftReplyToMessage.mockReset();
  sortMessages.mockReset().mockResolvedValue({ sorted: 0 });
});

const REPLY = {
  id: 1,
  body: 'Hello chris, about two weeks.',
  author_name: 'Back Office',
  created_at: '2026-09-18T11:00:00Z',
  emailed_at: '2026-09-18T11:00:01Z',
  sent: true,
  send_error: '',
};

describe('the messages pop-up', () => {
  it('opens the whole message from "Read all"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });

    expect(within(dialog).getByText(/Second line, which the table cuts off/)).toBeInTheDocument();
    expect(within(dialog).getByText('chris')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open in my mail program' })).toHaveAttribute(
      'href',
      'mailto:chris@chris.com?subject=Re%3A%20General%20question',
    );
  });

  it('opens from a click on the row too', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByText('General question'));
    expect(screen.getByRole('dialog', { name: 'General question' })).toBeInTheDocument();
  });

  it('marks the message handled from inside the pop-up', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });
    await user.click(within(dialog).getByRole('button', { name: 'Mark handled' }));

    expect(updateMessage).toHaveBeenCalledWith(4, { handled: true });
    expect(await within(dialog).findByRole('button', { name: '✓ Handled' })).toBeInTheDocument();
  });

  it('sends a reply from the pop-up and shows it as e-mailed', async () => {
    replyToMessage.mockResolvedValue({ ...MESSAGE, handled: true, replies: [REPLY] });
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Your answer to chris@chris.com' }),
      'Hello chris, about two weeks.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send reply' }));

    expect(replyToMessage).toHaveBeenCalledWith(4, 'Hello chris, about two weeks.');
    expect(await within(dialog).findByText(/Your reply was e-mailed to chris@chris.com/)).toBeInTheDocument();
    expect(within(dialog).getByText('E-mailed')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '✓ Handled' })).toBeInTheDocument();
  });

  it('keeps the text and says so when the e-mail could not be sent', async () => {
    replyToMessage.mockResolvedValue({
      ...MESSAGE,
      replies: [{ ...REPLY, sent: false, emailed_at: null, send_error: 'Connection refused' }],
    });
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });
    const box = within(dialog).getByRole('textbox', { name: 'Your answer to chris@chris.com' });
    await user.type(box, 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Send reply' }));

    expect(await within(dialog).findByText(/the e-mail could not be sent/)).toBeInTheDocument();
    expect(within(dialog).getByText('Not sent')).toBeInTheDocument();
    expect(box).toHaveValue('Hello');
  });
});

describe('Messages: Write with AI', () => {
  it('puts a draft in the reply box and sends nothing', async () => {
    draftReplyToMessage.mockResolvedValue({ body: 'Hello chris, it takes about [number] days.' });
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });
    await user.click(within(dialog).getByRole('button', { name: 'Write with AI' }));

    const box = within(dialog).getByRole('textbox', { name: 'Your answer to chris@chris.com' });
    expect(await within(dialog).findByText(/A first draft in their language/)).toBeInTheDocument();
    expect(box).toHaveValue('Hello chris, it takes about [number] days.');
    expect(draftReplyToMessage).toHaveBeenCalledWith(4);
    expect(replyToMessage).not.toHaveBeenCalled();
  });

  it('is not offered over a reply typed by hand', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Messages />);

    await user.click(await screen.findByRole('button', { name: 'Read all' }));
    const dialog = screen.getByRole('dialog', { name: 'General question' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Your answer to chris@chris.com' }), 'Hi');

    expect(within(dialog).getByRole('button', { name: 'Write with AI' })).toBeDisabled();
  });
});

describe('Messages: sorted by AI', () => {
  const SORTED = {
    ...MESSAGE,
    id: 5,
    subject: 'Complaint',
    ai_topic: 'damage',
    ai_urgency: 'high',
    ai_summary: 'Two boxes arrived broken on Bonaire.',
    ai_sorted_at: '2026-10-26T09:00:00Z',
  };

  it('asks for urgent first, and shows urgency, topic and the summary', async () => {
    listMessages.mockResolvedValue({ results: [SORTED], count: 1 });
    renderWithProviders(<Messages />);

    expect(await screen.findByText('Two boxes arrived broken on Bonaire.')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Urgent')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Damage or loss')).toBeInTheDocument();
    expect(listMessages).toHaveBeenCalledWith(expect.objectContaining({ ordering: 'urgency' }));
    // Everything is sorted already: nothing to ask the AI.
    expect(sortMessages).not.toHaveBeenCalled();
  });

  it('sorts unsorted messages once, then fetches the list again', async () => {
    listMessages.mockResolvedValueOnce({ results: [MESSAGE], count: 1 }).mockResolvedValue({
      results: [{ ...MESSAGE, ai_topic: 'tracking', ai_urgency: 'normal', ai_summary: 'Asks where the parcel is.', ai_sorted_at: '2026-10-26T09:00:00Z' }],
      count: 1,
    });
    sortMessages.mockResolvedValue({ sorted: 1 });
    renderWithProviders(<Messages />);

    expect(await screen.findByText('Asks where the parcel is.')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Where is my parcel')).toBeInTheDocument();
    expect(sortMessages).toHaveBeenCalledTimes(1);
  });

  it('filters by topic', async () => {
    const user = userEvent.setup();
    listMessages.mockResolvedValue({ results: [SORTED], count: 1 });
    renderWithProviders(<Messages />);
    await screen.findByText('Two boxes arrived broken on Bonaire.');

    await user.selectOptions(screen.getByLabelText('Topic'), 'damage');
    expect(listMessages).toHaveBeenLastCalledWith(expect.objectContaining({ ai_topic: 'damage' }));
  });
});
