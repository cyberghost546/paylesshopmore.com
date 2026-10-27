// The login page's second way in: a warehouse worker's four-digit code.
//
// What is worth pinning is what keeps a four-digit secret from being worse than
// it has to be on the client: only digits, never more than four, a typo caught
// before a guess is spent on it, one vague sentence for every failure, and the
// code never carried in a link.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ERRORS, AuthError } from '../../api/auth';
import { renderWithProviders } from '../../test/utils';
import Login from './Login';

const auth = { signIn: vi.fn(), signInWithCode: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const FLOOR = { role: 'warehouse', isWarehouse: true, isStaff: false };

function renderLogin(route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/warehouse" element={<p>Warehouse home</p>} />
      <Route path="/profile" element={<p>Customer profile</p>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  auth.signIn.mockReset();
  auth.signInWithCode.mockReset();
  window.localStorage.removeItem('plsm.loginMethod');
});

describe('Login with a warehouse code', () => {
  it('opens on the code form, with the address filled in, from the e-mailed link', () => {
    renderLogin('/login?method=code&email=wim%40example.com');

    expect(screen.getByRole('button', { name: 'Warehouse code' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('E-mail address')).toHaveValue('wim@example.com');
    expect(screen.queryByLabelText('Password')).toBeNull();
    // The address is already there, so the cursor goes to the part still to do.
    expect(screen.getByLabelText('Code')).toHaveFocus();
  });

  it('shows a customer the password form and nothing about warehouse codes', () => {
    renderLogin();

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).toBeNull();
    // No switch at all: the code is not something a customer has.
    expect(screen.queryByRole('button', { name: 'Warehouse code' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'How do you want to sign in?' })).toBeNull();
  });

  it('offers the switch once the code form is in play, from the e-mailed link', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code');

    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.queryByText('Forgotten your password?')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Password' }));

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('sends a warehouse worker who signs in with a password to the profile page', async () => {
    const user = userEvent.setup();
    auth.signIn.mockResolvedValue(FLOOR);
    renderLogin();

    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    // Like a customer; the profile page has the button to the warehouse.
    expect(await screen.findByText('Customer profile')).toBeInTheDocument();
  });

  it('sends an admin to the same profile page, where the Dashboard button is', async () => {
    const user = userEvent.setup();
    auth.signIn.mockResolvedValue({ role: 'admin', isStaff: true, isAdmin: true });
    renderLogin();

    await user.type(screen.getByLabelText('E-mail address'), 'boss@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Customer profile')).toBeInTheDocument();
  });

  it('keeps the address but not a half-typed secret when the way in is switched', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code');

    await user.click(screen.getByRole('button', { name: 'Password' }));
    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Warehouse code' }));
    await user.click(screen.getByRole('button', { name: 'Password' }));

    expect(screen.getByLabelText('E-mail address')).toHaveValue('wim@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('signs in with the address and the code and goes to the warehouse', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code&email=wim%40example.com');

    // No button: the fourth digit sends it.
    await user.type(screen.getByLabelText('Code'), '4821');

    expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
    expect(auth.signInWithCode).toHaveBeenCalledWith({
      email: 'wim@example.com',
      code: '4821',
    });
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('accepts only digits, and never more than four', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code');

    const code = screen.getByLabelText('Code');
    await user.type(code, '48 a-2 1 9');

    expect(code).toHaveValue('4821');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('catches a short code before it is sent, so no guess is spent on a typo', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code&email=wim%40example.com');

    await user.type(screen.getByLabelText('Code'), '48');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    // Announced as an alert, and tied to the field it is about.
    expect(screen.getByRole('alert')).toHaveTextContent('The code is exactly four digits.');
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
      /Four digits, from the e-mail\..*exactly four digits/,
    );
    expect(auth.signInWithCode).not.toHaveBeenCalled();
  });

  it('asks for the code when it is left empty', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code&email=wim%40example.com');

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByText('Please enter the four-digit code.')).toBeInTheDocument();
    expect(auth.signInWithCode).not.toHaveBeenCalled();
  });

  it('gives one vague answer however the code was wrong, and empties the field', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockRejectedValue(new AuthError(AUTH_ERRORS.INVALID_CREDENTIALS));
    renderLogin('/login?method=code&email=wim%40example.com');

    const code = screen.getByLabelText('Code');
    await user.type(code, '0000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code does not work. Check it, or ask an admin for a new one.',
    );
    // Not the password form's sentence, and not a reason the server never gave.
    expect(screen.queryByText('E-mail address or password is incorrect.')).toBeNull();
    await waitFor(() => expect(code).toHaveValue(''));
  });

  it('says so when there are too many attempts', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockRejectedValue(new AuthError(AUTH_ERRORS.RATE_LIMITED));
    renderLogin('/login?method=code&email=wim%40example.com');

    await user.type(screen.getByLabelText('Code'), '1234');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('leaves the password form working exactly as before', async () => {
    const user = userEvent.setup();
    auth.signIn.mockResolvedValue({ role: 'customer', isWarehouse: false, isStaff: false });
    renderLogin();

    await user.type(screen.getByLabelText('E-mail address'), 'jan@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(auth.signIn).toHaveBeenCalledWith({
      email: 'jan@example.com',
      password: 'a-long-enough-password',
      remember: false,
    });
    expect(auth.signInWithCode).not.toHaveBeenCalled();
    expect(await screen.findByText('Customer profile')).toBeInTheDocument();
  });
});

// A floor device is shared, and the next worker is waiting. These are the
// seconds at every handover: the form already on the code, no button to find,
// and nothing about the last person left behind for the next.
describe('Login on a shared floor device', () => {
  it('signs in on the fourth digit, once, without the button', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code');

    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('Code'), '482');
    expect(auth.signInWithCode).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Code'), '1');

    expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
    expect(auth.signInWithCode).toHaveBeenCalledWith({
      email: 'wim@example.com',
      code: '4821',
    });
    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('does not spend a guess while the address is still wrong', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code');

    await user.type(screen.getByLabelText('E-mail address'), 'wim@example');
    await user.type(screen.getByLabelText('Code'), '4821');

    expect(auth.signInWithCode).not.toHaveBeenCalled();
    // Nothing shouted at them either: they have not asked to log in yet.
    expect(screen.queryByRole('alert')).toBeNull();

    // The button is still there, and says what is wrong.
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('That e-mail address does not look right.')).toBeInTheDocument();
    expect(auth.signInWithCode).not.toHaveBeenCalled();
  });

  it('sends a pasted code the moment it lands', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code&email=wim%40example.com');

    await user.click(screen.getByLabelText('Code'));
    await user.paste('48-21');

    expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
    expect(auth.signInWithCode).toHaveBeenCalledWith({
      email: 'wim@example.com',
      code: '4821',
    });
  });

  it('moves from the address to the code on Enter, without submitting', async () => {
    const user = userEvent.setup();
    renderLogin('/login?method=code');

    const email = screen.getByLabelText('E-mail address');
    expect(email).toHaveAttribute('enterkeyhint', 'next');
    await user.type(email, 'wim@example.com{Enter}');

    expect(screen.getByLabelText('Code')).toHaveFocus();
    expect(auth.signInWithCode).not.toHaveBeenCalled();
    expect(screen.queryByText('Please enter the four-digit code.')).toBeNull();
  });

  it('keeps the button working for somebody who would rather press it', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    renderLogin('/login?method=code');

    // Code first, address second: nothing goes until they ask.
    await user.type(screen.getByLabelText('Code'), '4821');
    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    expect(auth.signInWithCode).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
  });

  it('opens on the code form next time on a device that signs in with codes', async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    const first = renderLogin('/login?method=code');
    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('Code'), '4821');
    await screen.findByText('Warehouse home');
    first.unmount();

    // Plain /login - where the guard sends a session that ran out.
    renderLogin();

    expect(screen.getByRole('button', { name: 'Warehouse code' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it("never keeps the last worker's address for the next one", async () => {
    const user = userEvent.setup();
    auth.signInWithCode.mockResolvedValue(FLOOR);
    const first = renderLogin('/login?method=code');
    await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
    await user.type(screen.getByLabelText('Code'), '4821');
    await screen.findByText('Warehouse home');
    first.unmount();

    renderLogin('/login?method=code');

    expect(screen.getByLabelText('E-mail address')).toHaveValue('');
    // Not in storage, and not offered by the browser from what was typed before.
    const stored = Object.keys(window.localStorage)
      .map((key) => window.localStorage.getItem(key))
      .join(' ');
    expect(stored).not.toContain('wim@example.com');
    expect(screen.getByLabelText('E-mail address')).toHaveAttribute('autocomplete', 'off');
  });

  it('goes back to the password form on a device where somebody used a password', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('plsm.loginMethod', 'code');
    auth.signIn.mockResolvedValue({ role: 'customer', isWarehouse: false, isStaff: false });
    const first = renderLogin();

    await user.click(screen.getByRole('button', { name: 'Password' }));
    await user.type(screen.getByLabelText('E-mail address'), 'jan@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByText('Customer profile');
    first.unmount();

    renderLogin();

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('still works when the browser refuses storage', async () => {
    const user = userEvent.setup();
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    auth.signInWithCode.mockResolvedValue(FLOOR);

    try {
      const first = renderLogin('/login?method=code');
      await user.type(screen.getByLabelText('E-mail address'), 'wim@example.com');
      await user.type(screen.getByLabelText('Code'), '4821');
      expect(await screen.findByText('Warehouse home')).toBeInTheDocument();
      first.unmount();

      // Remembered for as long as the page lives, which covers a sign-out.
      renderLogin();
      expect(screen.getByRole('button', { name: 'Warehouse code' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
