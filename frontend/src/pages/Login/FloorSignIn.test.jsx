// The login page on a shared floor device an admin registered: "Who is
// working?", tap your name, four digits, in.
//
// Worth pinning: the page opens on the ordinary form like everywhere else, the
// list is one button away and only when the server recognised the device, a PIN
// goes once and on the fourth digit, a wrong one is cleared and the list asked
// again (it may have locked), a locked or missing PIN sends the worker to the
// e-mailed code, and the ordinary form is still one tap away.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ERRORS, AuthError, getFloorRoster } from '../../api/auth';
import { renderWithProviders } from '../../test/utils';
import Login from './Login';

vi.mock('../../api/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  getFloorRoster: vi.fn(),
}));

const auth = { signIn: vi.fn(), signInWithCode: vi.fn(), signInWithPin: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const FLOOR = { role: 'warehouse', isWarehouse: true, isStaff: false };

const ROSTER = {
  device: { name: 'Scanner 1' },
  workers: [
    { id: 7, name: 'Ana S.', has_pin: true, locked: false },
    { id: 8, name: 'Wim T.', has_pin: true, locked: true },
    { id: 9, name: 'Kim B.', has_pin: false, locked: false },
  ],
};

// The button that opens "Who is working?" on a registered floor device.
const OPEN_LIST = 'Warehouse? Tap your name →';

async function openList(user) {
  await user.click(await screen.findByRole('button', { name: OPEN_LIST }));
}

function renderLogin(route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/warehouse" element={<p>Warehouse home</p>} />
      <Route path="/warehouse/pin" element={<p>Choose your PIN</p>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  window.localStorage.removeItem('plsm.loginMethod');
  auth.signIn.mockReset();
  auth.signInWithCode.mockReset();
  auth.signInWithPin.mockReset();
  getFloorRoster.mockReset().mockResolvedValue(ROSTER);
});

describe('Login on a registered floor device', () => {
  it('opens on the ordinary form, with the names one button away', async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(await screen.findByRole('button', { name: OPEN_LIST })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail address')).toBeInTheDocument();
    expect(screen.queryByText('Ana S.')).toBeNull();

    await openList(user);

    expect(screen.getByRole('heading', { name: 'Who is working?' })).toBeInTheDocument();
    expect(screen.getByText('Device: Scanner 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana S\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wim T\. Locked/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kim B\. No PIN yet/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail address')).toBeNull();
  });

  it('signs in with a name and four digits, once, without a button', async () => {
    const user = userEvent.setup();
    auth.signInWithPin.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code');

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Ana S\./ }));
    const pin = screen.getByLabelText('PIN for Ana S.');
    // Dots, not digits, and never offered to a password manager.
    expect(pin).toHaveAttribute('type', 'password');
    expect(pin).toHaveAttribute('autocomplete', 'off');
    expect(pin).toHaveFocus();
    await user.type(pin, '4826');

    expect(auth.signInWithPin).toHaveBeenCalledTimes(1);
    expect(auth.signInWithPin).toHaveBeenCalledWith({ worker: 7, pin: '4826' });
    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('clears a wrong PIN and asks for the list again, because it may have locked', async () => {
    const user = userEvent.setup();
    auth.signInWithPin.mockRejectedValue(new AuthError(AUTH_ERRORS.INVALID_CREDENTIALS));
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Ana S\./ }));
    await user.type(screen.getByLabelText('PIN for Ana S.'), '1111');

    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.');
    await waitFor(() => expect(screen.getByLabelText('PIN for Ana S.')).toHaveValue(''));
    expect(getFloorRoster).toHaveBeenCalledTimes(2);
  });

  it('says when the device has had too many wrong PINs', async () => {
    const user = userEvent.setup();
    auth.signInWithPin.mockRejectedValue(new AuthError(AUTH_ERRORS.RATE_LIMITED));
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Ana S\./ }));
    await user.type(screen.getByLabelText('PIN for Ana S.'), '1111');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many wrong PINs on this device.',
    );
  });

  it('sends somebody with a locked PIN to the e-mailed code, not to a PIN field', async () => {
    const user = userEvent.setup();
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Wim T\./ }));

    expect(screen.queryByLabelText(/PIN for/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Your PIN is locked');
    await user.click(screen.getByRole('button', { name: 'Sign in with an e-mailed code' }));

    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Warehouse code' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('tells somebody with no PIN yet how to get one', async () => {
    const user = userEvent.setup();
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Kim B\./ }));

    expect(screen.getByRole('status')).toHaveTextContent('You have no PIN yet.');
  });

  it('lets the wrong name be taken back', async () => {
    const user = userEvent.setup();
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: /Ana S\./ }));
    await user.click(screen.getByRole('button', { name: '← Not you?' }));

    expect(screen.getByRole('button', { name: /Kim B\./ })).toBeInTheDocument();
  });

  it('keeps the password form one tap away for the office', async () => {
    const user = userEvent.setup();
    renderLogin();

    await openList(user);
    await user.click(screen.getByRole('button', { name: 'Office: sign in with a password' }));

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    // And back to the names.
    await user.click(screen.getByRole('button', { name: OPEN_LIST }));
    expect(screen.getByRole('heading', { name: 'Who is working?' })).toBeInTheDocument();
  });

  it('opens on the code form from the e-mailed link, even on a floor device', async () => {
    renderLogin('/login?method=code&email=wim%40example.com');

    await waitFor(() => expect(getFloorRoster).toHaveBeenCalled());
    expect(screen.getByLabelText('E-mail address')).toHaveValue('wim@example.com');
    expect(screen.queryByRole('heading', { name: 'Who is working?' })).toBeNull();
  });

  it('is the ordinary form on any device nobody registered', async () => {
    getFloorRoster.mockRejectedValue(new AuthError(AUTH_ERRORS.UNAUTHENTICATED));
    renderLogin('/login?method=code');

    await waitFor(() => expect(getFloorRoster).toHaveBeenCalled());
    expect(screen.getByLabelText('E-mail address')).toBeInTheDocument();
    expect(screen.queryByText('Ana S.')).toBeNull();
  });

  it('goes on to choosing a PIN after signing in with an e-mailed code', async () => {
    const user = userEvent.setup();
    getFloorRoster.mockRejectedValue(new AuthError(AUTH_ERRORS.UNAUTHENTICATED));
    auth.signInWithCode.mockResolvedValue({ ...FLOOR, canSetPin: true });
    renderLogin('/login?method=code&email=wim%40example.com');

    await user.type(screen.getByLabelText('Code'), '4821');

    expect(await screen.findByText('Choose your PIN')).toBeInTheDocument();
  });
});

describe('the help robot on a floor device', () => {
  it('is put away while the login page of a registered device is up', async () => {
    const { unmount } = renderLogin();
    await screen.findByRole('button', { name: OPEN_LIST });

    // waitFor: the flag is set by an effect that can land a moment after the
    // heading when the whole suite runs at once (this test was flaky).
    await waitFor(() => expect(document.documentElement.dataset.floorDevice).toBe('true'));

    unmount();
    expect(document.documentElement.dataset.floorDevice).toBeUndefined();
  });

  it('stays for everybody else', async () => {
    getFloorRoster.mockRejectedValue(new AuthError(AUTH_ERRORS.UNAUTHENTICATED));
    renderLogin();

    await waitFor(() => expect(getFloorRoster).toHaveBeenCalled());
    expect(document.documentElement.dataset.floorDevice).toBeUndefined();
  });
});
