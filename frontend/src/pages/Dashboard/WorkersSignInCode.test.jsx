// Dashboard -> Workers: an admin e-mails a warehouse worker a four-digit
// sign-in code, from a box or from the worker's own row.
//
// The things worth pinning: it is an admin's button and nobody else's, the
// row button is only on an account a code can actually be used for, the
// reason for a refusal is shown where the admin is looking, and the code
// itself is never on screen - it goes to the worker's inbox.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERRORS, ApiError } from '../../api/client';
import { listWorkers, resetWorkerPin, sendWarehouseSignInCode } from '../../api/staff';
import { renderWithProviders } from '../../test/utils';
import Workers from './Workers';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  listWorkers: vi.fn(),
  resetWorkerPin: vi.fn(),
  sendWarehouseSignInCode: vi.fn(),
}));

const auth = { user: { id: 1, role: 'admin' }, refreshUser: vi.fn() };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

function worker(overrides) {
  return {
    id: 10,
    name: 'Wim Vloer',
    first_name: 'Wim',
    last_name: 'Vloer',
    username: 'wim@example.com',
    email: 'wim@example.com',
    phone_number: '',
    date_joined: '2026-01-05T09:00:00Z',
    role: 'warehouse',
    can_change_role: true,
    is_active: true,
    is_erased: false,
    is_superuser: false,
    ...overrides,
  };
}

const ROWS = [
  worker(),
  worker({ id: 11, name: 'Olga Kantoor', email: 'olga@example.com', role: 'office' }),
  worker({ id: 12, name: 'Piet Uit', email: 'piet@example.com', is_active: false }),
];

beforeEach(() => {
  auth.user = { id: 1, role: 'admin' };
  listWorkers
    .mockReset()
    .mockResolvedValue({ results: ROWS, count: ROWS.length, hasNext: false, hasPrevious: false });
  sendWarehouseSignInCode.mockReset();
});

describe('Workers: sending a warehouse sign-in code', () => {
  it('sends a code to the address an admin types, and says where it went', async () => {
    const user = userEvent.setup();
    sendWarehouseSignInCode.mockResolvedValue({
      sent_to: 'wim@example.com',
      expires_in_minutes: 15,
    });
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    await user.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    await user.type(screen.getByLabelText('Worker’s e-mail'), '  wim@example.com ');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(sendWarehouseSignInCode).toHaveBeenCalledWith('wim@example.com');
    expect(
      await screen.findByText(
        'A sign-in code has been e-mailed to wim@example.com. It works once, for 15 minutes.',
      ),
    ).toBeInTheDocument();
    // Emptied, ready for the next worker.
    expect(screen.getByLabelText('Worker’s e-mail')).toHaveValue('');
  });

  it('shows why an address was refused, under the field, and keeps what was typed', async () => {
    const user = userEvent.setup();
    sendWarehouseSignInCode.mockRejectedValue(
      new ApiError(
        API_ERRORS.VALIDATION,
        { email: ['That account’s role is Office worker. Sign-in codes are only for warehouse workers.'] },
        400,
      ),
    );
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    await user.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    await user.type(screen.getByLabelText('Worker’s e-mail'), 'olga@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText(/only for warehouse workers/)).toBeInTheDocument();
    // A pattern, not the exact label: the shared Field puts its error inside
    // the label, so the label's text now includes the reason.
    expect(screen.getByLabelText(/Worker’s e-mail/)).toHaveValue('olga@example.com');
  });

  it('puts a refusal from a row button in the banner, where there is no field', async () => {
    const user = userEvent.setup();
    sendWarehouseSignInCode.mockRejectedValue(
      new ApiError(API_ERRORS.UNAVAILABLE, { detail: 'The code could not be e-mailed. Try again in a moment.' }, 503),
    );
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    await user.click(screen.getByRole('button', { name: 'Send a sign-in code to Wim Vloer' }));

    expect(
      await screen.findByText('The code could not be e-mailed. Try again in a moment.'),
    ).toBeInTheDocument();
  });

  it('puts a one-click button on a warehouse worker who can sign in, and nobody else', async () => {
    const user = userEvent.setup();
    sendWarehouseSignInCode.mockResolvedValue({
      sent_to: 'wim@example.com',
      expires_in_minutes: 15,
    });
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    // Wim is a warehouse worker and active. Olga is office; Piet is warehouse
    // but cannot sign in - the same two rules the server applies.
    const buttons = screen.getAllByRole('button', { name: /^Send a sign-in code to / });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Send a sign-in code to Wim Vloer');

    await user.click(buttons[0]);

    expect(sendWarehouseSignInCode).toHaveBeenCalledWith('wim@example.com');
    expect(await screen.findByText(/has been e-mailed to wim@example.com/)).toBeInTheDocument();
  });

  it('would not show a code even if the server wrongly sent one', async () => {
    const user = userEvent.setup();
    // The server never returns it - see backend accounts/test_signin_codes.py.
    // This is the second lock: the page builds its sentence from where the
    // code went and how long it lasts, and from nothing else in the answer.
    sendWarehouseSignInCode.mockResolvedValue({
      sent_to: 'wim@example.com',
      expires_in_minutes: 15,
      code: '4821',
    });
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    await user.click(screen.getByRole('button', { name: 'Send a sign-in code to Wim Vloer' }));
    await screen.findByText(/has been e-mailed/);

    expect(screen.queryByText(/4821/)).toBeNull();
  });

  it('is an admin’s button and nobody else’s', async () => {
    auth.user = { id: 2, role: 'office' };
    renderWithProviders(<Workers />);
    await screen.findByText('Wim Vloer');

    expect(screen.queryByRole('button', { name: 'Send sign-in code' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send a sign-in code to/ })).toBeNull();
  });
});

describe('Workers: a warehouse worker’s floor PIN', () => {
  function withPins(...statuses) {
    const rows = ROWS.map((row, index) => ({ ...row, pin_status: statuses[index] ?? null }));
    listWorkers.mockResolvedValue({ results: rows, count: rows.length, hasNext: false, hasPrevious: false });
  }

  it('shows whether each warehouse worker has a PIN, never the PIN', async () => {
    withPins('locked', null, 'none');
    renderWithProviders(<Workers />);

    expect(await screen.findByText('PIN locked')).toBeInTheDocument();
    expect(screen.getByText('No PIN')).toBeInTheDocument();
  });

  it('lets an admin reset one, after asking', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    resetWorkerPin.mockReset().mockResolvedValue(null);
    withPins('set');
    renderWithProviders(<Workers />);

    await user.click(await screen.findByRole('button', { name: 'Reset the PIN of Wim Vloer' }));

    expect(resetWorkerPin).toHaveBeenCalledWith(10);
    expect(
      await screen.findByText(
        'Wim Vloer’s PIN has been reset. Send them a sign-in code so they can choose a new one.',
      ),
    ).toBeInTheDocument();
  });

  it('is not an office worker’s button', async () => {
    auth.user = { id: 1, role: 'office' };
    withPins('set');
    renderWithProviders(<Workers />);

    await screen.findByText('PIN set');
    expect(screen.queryByRole('button', { name: /Reset the PIN/ })).toBeNull();
  });
});

describe('Workers: a code shown on screen while there is no e-mail', () => {
  it('shows the code to pass on in person, until Done', async () => {
    const user = userEvent.setup();
    sendWarehouseSignInCode.mockResolvedValue({
      sent_to: 'wim@example.com',
      expires_in_minutes: 15,
      delivery: 'screen',
      code: '4821',
    });
    renderWithProviders(<Workers />);

    await user.click(await screen.findByRole('button', { name: 'Send a sign-in code to Wim Vloer' }));

    const box = await screen.findByRole('status', { name: 'Sign-in code' });
    expect(box).toHaveTextContent('Sign-in code for wim@example.com');
    expect(box).toHaveTextContent('4821');
    expect(box).toHaveTextContent('It works once, for 15 minutes.');
    // Not the e-mailed sentence: nothing was e-mailed.
    expect(screen.queryByText(/has been e-mailed/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('4821')).toBeNull();
  });
});
