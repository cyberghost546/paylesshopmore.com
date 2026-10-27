// The booking form's insurance section: how the insurance works, one tap
// away, and opened by itself when somebody chooses to insure.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import Booking from './Booking';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isChecking: false }),
}));

const TERMS =
  'The premium is 1.5% of the value of the goods + shipping costs, with a minimum premium of €95.00. ' +
  'The excess is 1% of the insured value, with a minimum excess of €250.00 and a maximum excess of €750.00.';

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => [] });
});

describe('booking: insurance terms', () => {
  it('are one tap away, and closed until asked for', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Booking />, { route: '/booking' });

    const button = screen.getByRole('button', { name: /How does the insurance work\?/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(TERMS)).toBeNull();

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(TERMS);

    await user.click(button);
    expect(screen.queryByText(TERMS)).toBeNull();
  });

  it('open by themselves when the customer chooses to insure', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Booking />, { route: '/booking' });

    await user.click(screen.getByLabelText('I would like to insure this shipment'));

    expect(screen.getByRole('note')).toHaveTextContent('minimum premium of €95.00');
  });

  it('are in Dutch word for word', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('plsm.language', 'nl');
    renderWithProviders(<Booking />, { route: '/booking' });

    await user.click(screen.getByRole('button', { name: /Hoe werkt de verzekering\?/ }));

    expect(screen.getByRole('note')).toHaveTextContent(
      'Het premiebedrag bedraagt 1.5% van de goederenwaarde + verschepingskosten met een minimumpremie van €95,00. ' +
        'Het eigen risico bedraagt 1% van de verzekerde waarde met een minimum eigen risico van ' +
        '€250,00 en een maximum eigen risico van €750,00.',
    );
  });
});
