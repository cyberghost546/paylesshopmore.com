// "Go to the warehouse" on the profile page: a warehouse worker who signed in
// with a password opens the warehouse with their e-mail and PIN.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ERRORS, AuthError } from '../../api/auth';
import { renderWithProviders } from '../../test/utils';
import WarehouseUnlock from './WarehouseUnlock';

const auth = { user: { hasPin: true, pinLocked: false }, unlockWarehouse: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const onOpened = vi.fn();

function renderForm() {
  return renderWithProviders(<WarehouseUnlock onOpened={onOpened} onCancel={vi.fn()} />);
}

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  auth.user = { hasPin: true, pinLocked: false };
  auth.unlockWarehouse = vi.fn().mockResolvedValue({});
  onOpened.mockReset();
});

describe('opening the warehouse from the profile page', () => {
  it('asks for the e-mail and PIN and opens on the fourth digit', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    const pin = screen.getByLabelText('PIN');
    expect(pin).toHaveAttribute('type', 'password');
    expect(pin).toHaveAttribute('autocomplete', 'off');
    await user.type(pin, '4826');

    expect(auth.unlockWarehouse).toHaveBeenCalledTimes(1);
    expect(auth.unlockWarehouse).toHaveBeenCalledWith({ email: 'wim@example.com', pin: '4826' });
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
  });

  it('says so and empties the PIN when it is wrong', async () => {
    const user = userEvent.setup();
    auth.unlockWarehouse.mockRejectedValue(new AuthError(AUTH_ERRORS.INVALID_CREDENTIALS));
    renderForm();

    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('PIN'), '1111');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That e-mail address or PIN is not right.',
    );
    expect(screen.getByLabelText('PIN')).toHaveValue('');
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('does not send anything without a proper address', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('PIN'), '4826');
    await user.click(screen.getByRole('button', { name: 'Open the warehouse' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your e-mail address.');
    expect(auth.unlockWarehouse).not.toHaveBeenCalled();
  });

  it('tells a worker with a locked PIN how to get a new one', () => {
    auth.user = { hasPin: true, pinLocked: true };
    renderForm();

    expect(screen.getByRole('status')).toHaveTextContent('Your PIN is locked');
    expect(screen.queryByLabelText('PIN')).toBeNull();
  });

  it('tells a worker with no PIN yet how to get one', () => {
    auth.user = { hasPin: false, pinLocked: false };
    renderForm();

    expect(screen.getByRole('status')).toHaveTextContent('You have no PIN yet.');
  });
});
