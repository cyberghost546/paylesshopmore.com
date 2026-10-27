// The chat assistant, as it is shown: inside the robot guide's panel. Hidden
// when off, a question and its answer, a tool round (the calculator), and the
// tools themselves. The server is mocked: no test reaches OpenAI.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import PageGuide from '../PageGuide/PageGuide';
import TutorialProvider from '../Tutorial/TutorialProvider';
import { COMPLETED_KEY, VERSION_KEY } from '../Tutorial/storage';
import { TUTORIAL_VERSION } from '../Tutorial/tutorialSteps';
import ChatProvider from './ChatProvider';
import { connectBookingForm } from './bookingBridge';
import { cleanBookingFields, runTool } from './tools';

vi.mock('../../api/assistant', () => ({
  assistantEnabled: vi.fn(),
  askAssistant: vi.fn(),
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));

const { assistantEnabled, askAssistant } = await import('../../api/assistant');

// The robot with the chat in it, as App.jsx puts them together. The tour is
// marked as done so it does not open over the tests.
function renderChat() {
  window.localStorage.setItem(COMPLETED_KEY, 'true');
  window.localStorage.setItem(VERSION_KEY, String(TUTORIAL_VERSION));
  return renderWithProviders(
    <TutorialProvider>
      <ChatProvider>
        <PageGuide />
      </ChatProvider>
    </TutorialProvider>,
  );
}

/** Open the robot, then the chat in it. */
async function openChat(user) {
  await user.click(screen.getByRole('button', { name: 'Open help and the guide for this page' }));
  await user.click(await screen.findByRole('button', { name: /Ask our assistant/ }));
}

beforeEach(() => {
  assistantEnabled.mockReset().mockResolvedValue(true);
  askAssistant.mockReset();
});

describe('ChatAssistant', () => {
  it('is not offered when the assistant is off', async () => {
    assistantEnabled.mockResolvedValue(false);
    const user = userEvent.setup();
    renderChat();
    await waitFor(() => expect(assistantEnabled).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Open help and the guide for this page' }));
    expect(screen.queryByRole('button', { name: /Ask our assistant/ })).not.toBeInTheDocument();
  });

  it('goes back to the help list and keeps the conversation', async () => {
    askAssistant.mockResolvedValue({ reply: 'Hello there.', tool_calls: [] });
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByLabelText('Type your question…'), 'Hi{Enter}');
    await screen.findByText('Hello there.');

    await user.click(screen.getByRole('button', { name: 'Back to help' }));
    expect(screen.queryByText('Hello there.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ask our assistant/ }));
    expect(screen.getByText('Hello there.')).toBeInTheDocument();
  });

  it('sends a question and shows the answer', async () => {
    askAssistant.mockResolvedValue({ reply: 'We ship to Aruba, Bonaire and Curaçao.', tool_calls: [] });
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByLabelText('Type your question…'), 'Where do you ship?{Enter}');

    expect(await screen.findByText('We ship to Aruba, Bonaire and Curaçao.')).toBeInTheDocument();
    expect(screen.getByText('Where do you ship?')).toBeInTheDocument();
    expect(askAssistant).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Where do you ship?' }],
      language: 'en',
      page: '/',
    });
  });

  it('runs a tool in the browser and sends its result back', async () => {
    const calculation = {
      destination: 'curacao',
      price_incl_vat: 121,
      vat_percent: 21,
      length_cm: 100,
      width_cm: 100,
      height_cm: 100,
      weight_grams: 5000,
      category: 'clothing',
      transport: 'sea',
    };
    askAssistant
      .mockResolvedValueOnce({
        reply: '',
        tool_calls: [{ call_id: 'call_1', name: 'calculate_shipping', arguments: JSON.stringify(calculation) }],
      })
      .mockResolvedValueOnce({ reply: 'Sea freight is EUR 180.', tool_calls: [] });
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.click(screen.getByRole('button', { name: 'What does shipping to Curaçao cost?' }));

    expect(await screen.findByText('Sea freight is EUR 180.')).toBeInTheDocument();
    const second = askAssistant.mock.calls[1][0].messages;
    expect(second[1]).toMatchObject({ type: 'function_call', call_id: 'call_1' });
    // 1 m³ by sea at EUR 180 per m³: the calculator's own sum.
    expect(JSON.parse(second[2].output)).toMatchObject({ freight: 180, duty: 10.5, priced: true });
  });

  it('says so when the assistant cannot answer', async () => {
    askAssistant.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByLabelText('Type your question…'), 'Hi{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('The assistant cannot answer right now');
  });
});

describe('tools', () => {
  it('fills the booking form, but never the signature or the terms', () => {
    const fill = vi.fn();
    const disconnect = connectBookingForm(fill);
    const navigate = vi.fn();

    const output = runTool(
      'fill_booking_form',
      JSON.stringify({
        sender_first_name: '  Maria ',
        destination: 'CW',
        freight: 'plane',
        agreed_terms: true,
        signature_name: 'Maria',
      }),
      { navigate, pathname: '/booking' },
    );

    expect(fill).toHaveBeenCalledWith({ sender_first_name: 'Maria', destination: 'CW' });
    expect(JSON.parse(output).filled).toEqual(['sender_first_name', 'destination']);
    expect(navigate).not.toHaveBeenCalled();
    disconnect();
  });

  it('opens the booking page first and fills it once it is there', () => {
    const navigate = vi.fn();
    runTool('fill_booking_form', JSON.stringify({ recipient_city: 'Willemstad' }), {
      navigate,
      pathname: '/',
    });
    expect(navigate).toHaveBeenCalledWith('/booking');

    // The page connects after navigating, and gets what was waiting.
    const fill = vi.fn();
    const disconnect = connectBookingForm(fill);
    expect(fill).toHaveBeenCalledWith({ recipient_city: 'Willemstad' });
    disconnect();
  });

  it('only opens pages of this site', () => {
    const navigate = vi.fn();
    runTool('open_page', JSON.stringify({ page: 'calculator' }), { navigate, pathname: '/' });
    expect(navigate).toHaveBeenCalledWith('/calculator');

    navigate.mockClear();
    const output = runTool('open_page', JSON.stringify({ page: 'https://evil.example' }), { navigate, pathname: '/' });
    expect(navigate).not.toHaveBeenCalled();
    expect(JSON.parse(output).error).toBeTruthy();
  });

  it('does not price an island the calculator has no prices for', () => {
    const output = JSON.parse(
      runTool('calculate_shipping', JSON.stringify({ destination: 'aruba' }), { navigate: vi.fn(), pathname: '/' }),
    );
    expect(output.priced).toBe(false);
  });

  it('turns an insured value into the text the form holds', () => {
    expect(cleanBookingFields({ insured: true, insured_value_eur: 250 })).toEqual({
      insured: true,
      insured_value_eur: '250',
    });
  });
});
