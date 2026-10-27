// A warehouse worker choosing their floor PIN straight after an e-mailed code.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERRORS, ApiError } from '../../api/client';
import { setPin } from '../../api/profile';
import { renderWithProviders } from '../../test/utils';
import SetPinPage from './SetPinPage';

vi.mock('../../api/profile', async (importOriginal) => ({
  ...(await importOriginal()),
  setPin: vi.fn(),
}));

const auth = { user: { canSetPin: true }, refreshUser: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/warehouse/pin" element={<SetPinPage />} />
      <Route path="/warehouse" element={<p>Warehouse home</p>} />
    </Routes>,
    { route: '/warehouse/pin' },
  );
}

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  auth.user = { canSetPin: true };
  auth.refreshUser = vi.fn().mockResolvedValue({});
  setPin.mockReset().mockResolvedValue(null);
});

describe('choosing a floor PIN', () => {
  it('saves a PIN typed twice and goes on to the warehouse', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New PIN'), '4826');
    // The fourth digit moves on to the repeat.
    expect(screen.getByLabelText('Repeat the PIN')).toHaveFocus();
    await user.type(screen.getByLabelText('Repeat the PIN'), '4826');
    await user.click(screen.getByRole('button', { name: 'Save PIN' }));

    expect(setPin).toHaveBeenCalledWith('4826');
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('catches two PINs that differ before anything is sent', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New PIN'), '4826');
    await user.type(screen.getByLabelText('Repeat the PIN'), '4827');
    await user.click(screen.getByRole('button', { name: 'Save PIN' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The two PINs are not the same.');
    expect(setPin).not.toHaveBeenCalled();
  });

  it('shows the server’s reason for refusing an easy PIN', async () => {
    const user = userEvent.setup();
    setPin.mockRejectedValue(
      new ApiError(API_ERRORS.VALIDATION, { pin: ['That PIN is too easy to guess.'] }, 400),
    );
    renderPage();

    await user.type(screen.getByLabelText('New PIN'), '1234');
    await user.type(screen.getByLabelText('Repeat the PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Save PIN' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is too easy to guess.');
    expect(screen.getByLabelText('New PIN')).toHaveValue('');
  });

  it('never offers the PIN to a password manager', () => {
    renderPage();

    for (const label of ['New PIN', 'Repeat the PIN']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password');
      expect(screen.getByLabelText(label)).toHaveAttribute('autocomplete', 'off');
    }
  });

  it('can be left for later', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('link', { name: 'Later' }));

    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('says how to get here when the session may not set a PIN', () => {
    auth.user = { canSetPin: false };
    renderPage();

    expect(screen.queryByLabelText('New PIN')).toBeNull();
    expect(
      screen.getByText(
        'You can only set your PIN straight after signing in with an e-mailed code.',
      ),
    ).toBeInTheDocument();
  });
});
