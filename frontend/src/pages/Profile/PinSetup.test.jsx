// "Go to the warehouse" for a worker with no PIN yet, or a locked one: the
// sign-in code from an admin and a new PIN, in one step.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERRORS, ApiError } from '../../api/client';
import { renderWithProviders } from '../../test/utils';
import PinSetup from './PinSetup';

const auth = { setupWarehousePin: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const onOpened = vi.fn();

function renderForm(locked = false) {
  return renderWithProviders(<PinSetup locked={locked} onOpened={onOpened} onCancel={vi.fn()} />);
}

async function fill(user, { code = '4821', pin = '5937', repeat = pin } = {}) {
  await user.type(screen.getByLabelText('Sign-in code from the admin'), code);
  await user.type(screen.getByLabelText('New PIN'), pin);
  await user.type(screen.getByLabelText('Repeat the PIN'), repeat);
  await user.click(screen.getByRole('button', { name: 'Save PIN and open the warehouse' }));
}

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  auth.setupWarehousePin = vi.fn().mockResolvedValue({});
  onOpened.mockReset();
});

describe('setting a PIN on the profile page', () => {
  it('says what to do, without sending anybody to their e-mail', () => {
    renderForm();

    expect(screen.getByRole('status')).toHaveTextContent(
      'You have no PIN yet. Ask an admin for a sign-in code, enter it below, and choose your PIN.',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('e-mail');
  });

  it('sets the PIN with the code and opens the warehouse', async () => {
    const user = userEvent.setup();
    renderForm();

    await fill(user);

    expect(auth.setupWarehousePin).toHaveBeenCalledWith({ code: '4821', pin: '5937' });
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
  });

  it('catches two different PINs before anything is sent', async () => {
    const user = userEvent.setup();
    renderForm();

    await fill(user, { repeat: '5938' });

    expect(screen.getByRole('alert')).toHaveTextContent('The two PINs are not the same.');
    expect(auth.setupWarehousePin).not.toHaveBeenCalled();
  });

  it('shows why an easy PIN was refused, and keeps the code', async () => {
    const user = userEvent.setup();
    auth.setupWarehousePin.mockRejectedValue(
      new ApiError(API_ERRORS.VALIDATION, { pin: ['That PIN is too easy to guess.'] }, 400),
    );
    renderForm();

    await fill(user, { pin: '1234' });

    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is too easy to guess.');
    // The code was not spent, so it stays in its box.
    expect(screen.getByLabelText('Sign-in code from the admin')).toHaveValue('4821');
    expect(screen.getByLabelText('New PIN')).toHaveValue('');
  });

  it('says when the code does not work', async () => {
    const user = userEvent.setup();
    auth.setupWarehousePin.mockRejectedValue(new ApiError(API_ERRORS.INVALID_CREDENTIALS, null, 401));
    renderForm();

    await fill(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('That sign-in code does not work.');
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('works the same for a locked PIN', () => {
    renderForm(true);

    expect(screen.getByRole('status')).toHaveTextContent('Your PIN is locked');
    expect(screen.getByLabelText('Sign-in code from the admin')).toBeInTheDocument();
  });
});
